import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { desc, eq, sql } from "drizzle-orm";
import { readFile, readdir } from "fs/promises";
import { join } from "path";
import { fileURLToPath } from "url";
import type { Message, ToolCall } from "@/types";
import * as schema from "@/storage/schema";
import { config, ensureDataDir } from "@/utils/config";

type TokenTotals = {
  input: number;
  output: number;
  total: number;
};

type Db = ReturnType<typeof drizzle<typeof schema>>;
type ToolCallRow = typeof schema.toolCalls.$inferSelect;

const MIGRATIONS_DIR = fileURLToPath(new URL("./migrations", import.meta.url));
const EMPTY_TOKENS = { input: 0, output: 0, total: 0 } satisfies TokenTotals;

let sqlite: Database | null = null;
let db: Db | null = null;

const toJson = (value: unknown) => {
  if (value === undefined) return null;
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify({ error: "Value was not JSON serializable" });
  }
};

const fromJson = <T,>(value: string | null, fallback: T): T => {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

const toDate = (value: string | null) => value ? new Date(value) : undefined;

const tokens = (value?: TokenTotals | null): TokenTotals => ({
  input: value?.input ?? 0,
  output: value?.output ?? 0,
  total: value?.total ?? 0,
});

async function migrate(database: Database) {
  const current = (database.query("PRAGMA user_version").get() as { user_version?: number } | null)
    ?.user_version ?? 0;
  const migrations = (await readdir(MIGRATIONS_DIR))
    .map((filename) => {
      const version = Number(filename.match(/^(\d+)_.*\.sql$/)?.[1]);
      return Number.isFinite(version) ? { filename, version } : null;
    })
    .filter((migration): migration is { filename: string; version: number } => Boolean(migration))
    .sort((a, b) => a.version - b.version);

  const run = database.transaction((migrationSql: string, version: number) => {
    database.run(migrationSql);
    database.run(`PRAGMA user_version = ${version}`);
  });

  for (const migration of migrations) {
    if (migration.version <= current) continue;
    run(await readFile(join(MIGRATIONS_DIR, migration.filename), "utf-8"), migration.version);
  }
}

async function getDb(): Promise<Db | null> {
  try {
    await ensureDataDir();
    if (!sqlite || !db) {
      sqlite = new Database(config.paths.databaseFile);
      sqlite.run("PRAGMA foreign_keys = ON");
      await migrate(sqlite);
      db = drizzle(sqlite, { schema });
    }
    return db;
  } catch (error) {
    console.error("Failed to open Arc database:", error);
    return null;
  }
}

function reviveToolCall(row: ToolCallRow): ToolCall {
  const startedAt = toDate(row.startedAt);
  const completedAt = toDate(row.completedAt);
  return {
    id: row.id,
    ...(row.approvalId ? { approvalId: row.approvalId } : {}),
    assistantMessageIndex: row.assistantMessageIndex,
    name: row.name,
    args: fromJson(row.argsJson, {}),
    status: row.status,
    timestamp: new Date(row.timestamp),
    ...(row.resultJson ? { result: fromJson(row.resultJson, undefined) } : {}),
    ...(row.errorJson ? { error: fromJson(row.errorJson, undefined) } : {}),
    ...(startedAt ? { startedAt } : {}),
    ...(completedAt ? { completedAt } : {}),
    ...(row.durationMs !== null ? { durationMs: row.durationMs } : {}),
  };
}

function setCurrentSession(database: Db, sessionId: string) {
  database.insert(schema.appState)
    .values({ key: "current_session_id", value: sessionId })
    .onConflictDoUpdate({
      target: schema.appState.key,
      set: { value: sessionId },
    })
    .run();
}

function readSession(database: Db, sessionId: string) {
  const session = database.select().from(schema.sessions).where(eq(schema.sessions.id, sessionId)).get();
  if (!session) return null;

  const messages = database.select({
    role: schema.messages.role,
    content: schema.messages.content,
  })
    .from(schema.messages)
    .where(eq(schema.messages.sessionId, sessionId))
    .orderBy(schema.messages.orderIndex)
    .all();

  const toolCalls = database.select()
    .from(schema.toolCalls)
    .where(eq(schema.toolCalls.sessionId, sessionId))
    .orderBy(schema.toolCalls.timestamp)
    .all();

  return {
    id: session.id,
    title: session.title,
    messages,
    toolCalls: toolCalls.map(reviveToolCall),
    timestamp: session.updatedAt,
    ...(session.model ? { model: session.model } : {}),
    conversationSummary: session.conversationSummary,
    cumulativeTokens: {
      input: session.inputTokens,
      output: session.outputTokens,
      total: session.totalTokens,
    },
  };
}

export type PersistedSession = NonNullable<ReturnType<typeof readSession>>;

function saveToDb(database: Db, session: PersistedSession) {
  database.transaction((tx) => {
    const now = new Date().toISOString();
    const updatedAt = session.timestamp ?? now;
    const totals = tokens(session.cumulativeTokens);

    tx.insert(schema.sessions)
      .values({
        id: session.id,
        title: session.title,
        model: session.model ?? null,
        conversationSummary: session.conversationSummary ?? "",
        inputTokens: totals.input,
        outputTokens: totals.output,
        totalTokens: totals.total,
        createdAt: now,
        updatedAt,
      })
      .onConflictDoUpdate({
        target: schema.sessions.id,
        set: {
          title: session.title,
          model: session.model ?? null,
          conversationSummary: session.conversationSummary ?? "",
          inputTokens: totals.input,
          outputTokens: totals.output,
          totalTokens: totals.total,
          updatedAt,
        },
      })
      .run();

    tx.delete(schema.messages).where(eq(schema.messages.sessionId, session.id)).run();
    tx.delete(schema.toolCalls).where(eq(schema.toolCalls.sessionId, session.id)).run();

    if (session.messages.length) {
      tx.insert(schema.messages).values(session.messages.map((message, orderIndex) => ({
        sessionId: session.id,
        role: message.role,
        content: message.content,
        orderIndex,
        createdAt: now,
      }))).run();
    }

    if (session.toolCalls.length) {
      tx.insert(schema.toolCalls).values(session.toolCalls.map((toolCall) => ({
        id: toolCall.id,
        approvalId: toolCall.approvalId ?? null,
        sessionId: session.id,
        assistantMessageIndex: toolCall.assistantMessageIndex,
        name: toolCall.name,
        argsJson: toJson(toolCall.args ?? {}) ?? "{}",
        resultJson: toJson(toolCall.result),
        errorJson: toJson(toolCall.error),
        status: toolCall.status,
        timestamp: toolCall.timestamp.toISOString(),
        startedAt: toolCall.startedAt?.toISOString() ?? null,
        completedAt: toolCall.completedAt?.toISOString() ?? null,
        durationMs: toolCall.durationMs ?? null,
      }))).run();
    }
  });
}

export async function createSession(model?: string): Promise<PersistedSession | null> {
  const database = await getDb();
  if (!database) return null;

  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const session: PersistedSession = {
    id,
    title: `Session ${new Date().toLocaleString()}`,
    messages: [],
    toolCalls: [],
    timestamp: new Date().toISOString(),
    model,
    conversationSummary: "",
    cumulativeTokens: EMPTY_TOKENS,
  };

  try {
    saveToDb(database, session);
    setCurrentSession(database, id);
    return session;
  } catch (error) {
    console.error("Failed to create session:", error);
    return null;
  }
}

export async function listSessions() {
  const database = await getDb();
  if (!database) return [];

  return database.select({
    id: schema.sessions.id,
    title: schema.sessions.title,
    timestamp: schema.sessions.updatedAt,
    model: schema.sessions.model,
    messageCount: sql<number>`cast(count(${schema.messages.id}) as int)`,
  })
    .from(schema.sessions)
    .leftJoin(schema.messages, eq(schema.messages.sessionId, schema.sessions.id))
    .groupBy(schema.sessions.id)
    .orderBy(desc(schema.sessions.updatedAt))
    .all()
    .map(({ model, ...session }) => ({
      ...session,
      ...(model ? { model } : {}),
    }));
}

export type SessionMeta = Awaited<ReturnType<typeof listSessions>>[number];

export async function saveSession(
  sessionId: string,
  messages: Message[],
  toolCalls: ToolCall[],
  model?: string,
  conversationSummary?: string,
  cumulativeTokens?: TokenTotals,
  title?: string,
) {
  const database = await getDb();
  if (!database) return;

  const existing = readSession(database, sessionId);
  const firstUser = messages.find((msg) => msg.role === "user")?.content?.trim();
  try {
    saveToDb(database, {
      id: sessionId,
      title: title ?? existing?.title ?? (firstUser
        ? firstUser.replace(/\s+/g, " ").slice(0, 48)
        : `Session ${sessionId.slice(0, 8)}`),
      messages,
      toolCalls,
      timestamp: new Date().toISOString(),
      model,
      conversationSummary: conversationSummary ?? existing?.conversationSummary ?? "",
      cumulativeTokens: tokens(cumulativeTokens ?? existing?.cumulativeTokens),
    });
    setCurrentSession(database, sessionId);
  } catch (error) {
    console.error("Failed to save session:", error);
  }
}

export async function loadSession(sessionId?: string): Promise<PersistedSession | null> {
  const database = await getDb();
  if (!database) return null;

  if (sessionId) {
    const session = readSession(database, sessionId);
    if (session) setCurrentSession(database, session.id);
    return session;
  }

  const current = database.select({ value: schema.appState.value })
    .from(schema.appState)
    .where(eq(schema.appState.key, "current_session_id"))
    .get()?.value;
  const session = current ? readSession(database, current) : null;
  if (session) return session;

  const latest = database.select({ id: schema.sessions.id })
    .from(schema.sessions)
    .orderBy(desc(schema.sessions.updatedAt))
    .limit(1)
    .get();
  if (!latest) return null;

  const loaded = readSession(database, latest.id);
  if (loaded) setCurrentSession(database, loaded.id);
  return loaded;
}

export async function clearSession(sessionId: string) {
  const database = await getDb();
  const existing = database ? readSession(database, sessionId) : null;
  await saveSession(sessionId, [], [], existing?.model, "", EMPTY_TOKENS, existing?.title);
}
