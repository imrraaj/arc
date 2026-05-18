import {
  type LanguageModelUsage,
  type ModelMessage,
  type ToolApprovalResponse,
  stepCountIs,
  streamText,
} from "ai";

import { nvidia } from "@/provider";
import { config } from "@/utils/config";
import {
  prepareMessages,
  compactMemoryTool,
  shouldCompact,
} from "@/context/memory";
import { webSearchTool, applyPatchTool, createFileTool, readFileTool, subAgentTool } from "@/tools";
import {
  discoverSkills,
  discoverSkillsTool,
  loadSkillTool,
} from "@/tools/skill";
import { grepTool } from "@/tools/grep";
import { runCommandTool } from "@/tools/command";
import type { Message, ToolCall } from "@/types";

type StateUpdate<T> = T | ((prev: T) => T);

interface RunAgentTurnOptions {
  prompt: string;
  messages: Message[];
  messagesWithPrompt: Message[];
  selectedModel: string;
  nvidiaApiKey: string;
  conversationSummary: string;
  abortSignal?: AbortSignal;
  askUserApproval: (toolCall: ApprovalToolCall) => Promise<boolean>;
  onMessagesChange: (update: StateUpdate<Message[]>) => void;
  onToolCallsChange: (update: StateUpdate<ToolCall[]>) => void;
  onStreamText: (text: string) => void;
  onCompactingChange: (isCompacting: boolean) => void;
  onConversationSummary: (summary: string) => void;
  onUsage: (usage: LanguageModelUsage | undefined) => void;
}

type ApprovalToolCall = {
  id: string;
  approvalId: string;
  name: string;
  args: Record<string, unknown>;
};

function isAbortError(error: unknown): boolean {
  const err = error as { name?: unknown; message?: unknown; cause?: unknown };
  const cause = err.cause as { name?: unknown } | undefined;
  return (
    err.name === "AbortError" ||
    (typeof err.message === "string" && err.message.includes("abort")) ||
    cause?.name === "AbortError"
  );
}

function toModelMessages(messages: Message[]): ModelMessage[] {
  return messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));
}

function removeCompactionMessage(messages: Message[]): Message[] {
  const last = messages.at(-1);
  if (last?.role === "assistant" && last.content === "Compacting memory...") {
    return messages.slice(0, -1);
  }
  return messages;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function serializeError(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }
  return error;
}

function textFromContent(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";

  return value
    .map((part) =>
      part &&
      typeof part === "object" &&
      "text" in part &&
      typeof part.text === "string"
        ? part.text
        : ""
    )
    .join("");
}

function firstText(...values: unknown[]) {
  return values
    .map(textFromContent)
    .find((text) => text.trim().length > 0)
    ?.trimEnd() ?? "";
}

function textFromMessages(messages: ModelMessage[]) {
  return firstText(
    ...messages
      .filter((message) => message.role === "assistant")
      .map((message) => message.content)
  );
}

export async function runAgentTurn({
  prompt,
  messages,
  messagesWithPrompt,
  selectedModel,
  nvidiaApiKey,
  conversationSummary,
  abortSignal,
  askUserApproval,
  onMessagesChange,
  onToolCallsChange,
  onStreamText,
  onCompactingChange,
  onConversationSummary,
  onUsage,
}: RunAgentTurnOptions): Promise<void> {
  const assistantMessageIndex = messagesWithPrompt.length;
  const needsCompaction = shouldCompact(messages, prompt);
  const model = nvidia(selectedModel, nvidiaApiKey);

  let messagesToSend: ModelMessage[] = toModelMessages(messagesWithPrompt);

  if (conversationSummary) {
    messagesToSend = [
      {
        role: "system",
        content: `[Earlier Conversation Summary]: ${conversationSummary}`,
      },
      ...messagesToSend,
    ];
  }

  if (needsCompaction) {
    onCompactingChange(true);
    onMessagesChange((prev) => [
      ...prev,
      { role: "assistant", content: "Compacting memory..." },
    ]);

    try {
      const prepared = await prepareMessages(
        messages,
        model,
        abortSignal
      );

      messagesToSend = toModelMessages(prepared.messages);

      if (prepared.summary) {
        onConversationSummary(prepared.summary);
      }
    } catch (error) {
      if (isAbortError(error)) return;
      console.error("Memory compaction failed:", error);
    } finally {
      onMessagesChange(removeCompactionMessage);
      onCompactingChange(false);
    }
  }

  try {
    const skills = await discoverSkills();

    while (true) {
      const result = streamText({
        model,
        system: config.prompts.system,
        messages: messagesToSend,
        stopWhen: stepCountIs(5),
        abortSignal,
        tools: {
          web_search: webSearchTool,
          subagent: subAgentTool,
          load_skill: loadSkillTool,
          discoverSkills: discoverSkillsTool,
          grep: grepTool,
          run_command: runCommandTool,
          compact_memory: compactMemoryTool,
          read_file: readFileTool,
          apply_patch: applyPatchTool,
          create_file: createFileTool,
        },
        experimental_context: {
          skills,
          nvidiaApiKey,
        },
        experimental_onToolCallStart: ({ toolCall }) => {
          const id = toolCall.toolCallId;
          onToolCallsChange((prev) => {
            const existing = prev.find((tc) => tc.id === id);
            if (existing) {
              return prev.map((tc) =>
                tc.id === id
                  ? { ...tc, status: "running", startedAt: new Date() }
                  : tc
              );
            }
            return [
              ...prev,
              {
                id,
                assistantMessageIndex,
                name: toolCall.toolName,
                args: asRecord(toolCall.input),
                status: "running",
                timestamp: new Date(),
                startedAt: new Date(),
              },
            ];
          });
        },
        experimental_onToolCallFinish: ({ toolCall, durationMs, success, output, error }) => {
          const id = toolCall.toolCallId;
          onToolCallsChange((prev) =>
            prev.map((tc) =>
              tc.id === id
                ? {
                    ...tc,
                    status: success ? "completed" : "error",
                    result: success ? output : tc.result,
                    error: success ? undefined : serializeError(error),
                    completedAt: new Date(),
                    durationMs,
                  }
                : tc
            )
          );
        },
        onFinish: ({ usage }) => onUsage(usage),
      });

      let fullText = "";
      for await (const chunk of result.textStream) {
        fullText += chunk;
        onStreamText(fullText);
      }

      const [content, response, finalText, reasoningText] = await Promise.all([
        result.content,
        result.response,
        result.text,
        result.reasoningText,
      ]);
      const assistantText = firstText(
        fullText,
        finalText,
        content,
        textFromMessages(response.messages),
        reasoningText
      );

      const approvalRequests = content.filter(
        (p) => p.type === "tool-approval-request"
      );

      if (approvalRequests.length === 0) {
        onMessagesChange((prev) => [
          ...prev,
          { role: "assistant", content: assistantText || "(empty response)" },
        ]);
        onToolCallsChange((prev) =>
          prev.map((tc) =>
            tc.assistantMessageIndex === -1
              ? { ...tc, assistantMessageIndex }
              : tc
          )
        );
        onStreamText("");
        break;
      }

      onStreamText("");

      const pendingToolCalls: ToolCall[] = approvalRequests.map((req) => {
        const r = req;
        return {
          id: r.toolCall.toolCallId,
          approvalId: r.approvalId,
          assistantMessageIndex,
          name: r.toolCall.toolName,
          args: asRecord(r.toolCall.input),
          status: "pending" as const,
          timestamp: new Date(),
        };
      });
      onToolCallsChange((prev) => [...prev, ...pendingToolCalls]);

      const approvals: ToolApprovalResponse[] = [];
      for (const req of approvalRequests) {
        const r = req;
        const approved = await askUserApproval({
          id: r.toolCall.toolCallId,
          approvalId: r.approvalId,
          name: r.toolCall.toolName,
          args: asRecord(r.toolCall.input),
        });

        onToolCallsChange((prev) =>
          prev.map((tc) =>
            tc.id === r.toolCall.toolCallId
              ? {
                  ...tc,
                  status: approved ? "approved" : "denied",
                  result: approved ? tc.result : { approved: false },
                  completedAt: approved ? tc.completedAt : new Date(),
                }
              : tc
          )
        );

        approvals.push({
          type: "tool-approval-response",
          approvalId: r.approvalId,
          approved,
        });
      }

      messagesToSend = [
        ...messagesToSend,
        ...response.messages,
        { role: "tool", content: approvals },
      ];

      onToolCallsChange((prev) =>
        prev.map((tc) =>
          tc.status === "running" && tc.result !== undefined
            ? { ...tc, status: "completed", completedAt: tc.completedAt ?? new Date() }
            : tc
        )
      );
    }
  } catch (error) {
    const content = isAbortError(error)
      ? "Generation cancelled."
      : `Error: ${error instanceof Error ? error.message : "Failed to reach LLM"}`;

    onMessagesChange((prev) => [
      ...prev,
      { role: "assistant", content },
    ]);
    onToolCallsChange((prev) =>
      prev.map((tc) =>
        tc.assistantMessageIndex === -1
          ? { ...tc, assistantMessageIndex }
          : tc
      )
    );
  }
}
