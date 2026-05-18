import { generateText, tool, type LanguageModel } from "ai";
import { z } from "zod";
import type { Message } from "../types";
import { config as appConfig } from "@/utils/config";

const estimateTokens = (text: string): number => Math.ceil(text.length / 4);
const totalTokens = (messages: Message[]): number =>
  messages.reduce((sum, msg) => sum + estimateTokens(msg.content), 0);

export function shouldCompact(
  messages: Message[],
  pendingPrompt?: string
): boolean {
  const tokenCount = totalTokens(messages) + estimateTokens(pendingPrompt ?? "");
  const threshold =
    appConfig.memory.contextWindow * appConfig.memory.compactionThreshold -
    appConfig.memory.safetyBuffer;

  return tokenCount >= threshold;
}

async function summarizeMessages(
  messages: Message[],
  model: LanguageModel,
  signal?: AbortSignal
): Promise<string> {
  if (messages.length === 0) {
    return "";
  }

  try {
    const result = await generateText({
      model,
      system: appConfig.prompts.summarizeSystem,
      prompt: appConfig.prompts.summarizeUser(
        messages
          .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
          .join("\n\n")
      ),
      abortSignal: signal,
    });

    return result.text.trim();
  } catch (error) {
    if (
      error instanceof Error &&
      (error.name === "AbortError" || error.message.includes("abort"))
    ) {
      throw error;
    }
    console.error("Failed to summarize messages:", error);
    return "[Summary unavailable - compaction failed]";
  }
}

export async function prepareMessages(
  messages: Message[],
  model: LanguageModel,
  signal?: AbortSignal,
  forceCompact: boolean = false
): Promise<{
  messages: Message[];
  summary?: string;
}> {
  if (!forceCompact && !shouldCompact(messages)) return { messages };

  const splitIndex = Math.max(0, messages.length - appConfig.memory.windowSize);
  const older = messages.slice(0, splitIndex);
  const summary = older.length ? await summarizeMessages(older, model, signal) : "";
  const summaryMessage: Message = {
    role: "system",
    content: `[Earlier Conversation Summary]: ${summary}`,
  };

  return {
    messages: [summaryMessage, ...messages.slice(splitIndex)],
    summary,
  };
}

export const compactMemoryTool = tool({
  description: "Manually compact memory when context window is getting full. Use when the conversation is becoming too long or when user requests compaction. This summarizes older messages and keeps recent ones for context.",
  inputSchema: z.object({
    force: z.boolean().optional().describe("Force compaction even if not at threshold"),
  }),
  needsApproval: false,
  execute: async ({ force }) => {
    return {
      shouldCompact: true,
      force: force || false,
      message: "Compaction requested. The system will now summarize older messages and keep recent ones.",
    };
  },
});
