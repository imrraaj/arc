import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const appState = sqliteTable("app_state", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  model: text("model"),
  conversationSummary: text("conversation_summary").notNull().default(""),
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  totalTokens: integer("total_tokens").notNull().default(0),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const messages = sqliteTable("messages", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sessionId: text("session_id").notNull().references(() => sessions.id, { onDelete: "cascade" }),
  role: text("role", { enum: ["user", "assistant", "system"] }).notNull(),
  content: text("content").notNull(),
  orderIndex: integer("order_index").notNull(),
  createdAt: text("created_at").notNull(),
});

export const toolCalls = sqliteTable("tool_calls", {
  id: text("id").primaryKey(),
  approvalId: text("approval_id"),
  sessionId: text("session_id").notNull().references(() => sessions.id, { onDelete: "cascade" }),
  assistantMessageIndex: integer("assistant_message_index").notNull(),
  name: text("name").notNull(),
  argsJson: text("args_json").notNull(),
  resultJson: text("result_json"),
  errorJson: text("error_json"),
  status: text("status", {
    enum: ["pending", "approved", "denied", "running", "completed", "error"],
  }).notNull(),
  timestamp: text("timestamp").notNull(),
  startedAt: text("started_at"),
  completedAt: text("completed_at"),
  durationMs: integer("duration_ms"),
});
