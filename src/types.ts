export type Message = {
  role: "user" | "assistant" | "system";
  content: string;
};

export type ToolCall = {
  id: string;
  approvalId?: string;
  assistantMessageIndex: number;
  name: string;
  args: Record<string, unknown>;
  result?: unknown;
  error?: unknown;
  status: "pending" | "approved" | "denied" | "running" | "completed" | "error";
  timestamp: Date;
  startedAt?: Date;
  completedAt?: Date;
  durationMs?: number;
};

export type PendingApproval = {
  id: string;
  approvalId: string;
  toolName: string;
  args: Record<string, unknown>;
  resolve: (approved: boolean) => void;
};
