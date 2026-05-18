import { t, bold, fg } from "@opentui/core";
import { theme, colors, getToolStatusColor } from "../theme";
import type { ToolCall } from "../types";

interface ToolCallViewProps {
  toolCall: ToolCall;
}

const STATUS_ICONS: Record<ToolCall["status"], string> = {
  pending: "○",
  approved: "✓",
  denied: "✗",
  running: "⚡",
  completed: "✓",
  error: "!",
};

function prettyPrintJSON(obj: unknown, maxLength: number = 300): string {
  const formatted = JSON.stringify(obj, null, 2);
  if (!formatted) return "";
  if (formatted.length <= maxLength) return formatted;
  return formatted.slice(0, maxLength) + "\n... (truncated)";
}

export function ToolCallView({ toolCall }: ToolCallViewProps) {
  const statusColor = getToolStatusColor(toolCall.status);
  const argsDisplay = prettyPrintJSON(toolCall.args, 200);
  const resultDisplay = toolCall.result !== undefined
    ? prettyPrintJSON(toolCall.result, 400)
    : null;
  const errorDisplay = toolCall.error !== undefined
    ? prettyPrintJSON(toolCall.error, 400)
    : null;
  const duration = toolCall.durationMs === undefined ? "" : ` ${toolCall.durationMs}ms`;

  return (
    <box
      width="100%"
      marginTop={1}
      paddingX={1}
      paddingY={1}
      backgroundColor={colors.bg}
      border={["left"]}
      borderStyle="single"
      borderColor={colors.yellow}
    >
      <box width="100%" flexDirection="row" gap={1}>
        <text content={t`${fg(theme.yellow)("🔧 ")}${bold(fg(theme.yellow)(toolCall.name))}`} />
        <text content={t` ${fg(statusColor)(`${STATUS_ICONS[toolCall.status]} ${toolCall.status}${duration}`)}`} />
      </box>

      <box width="100%" flexDirection="column" marginTop={1}>
        <text content={t`${fg(theme.comment)("Args:")}`} />
        <text content={argsDisplay} />
      </box>

      {toolCall.status === "running" && (
        <box width="100%" marginTop={1}>
          <text content={t`${bold(fg(theme.yellow)("⚡ Running..."))}`} />
        </box>
      )}

      {toolCall.status === "completed" && resultDisplay && (
        <box width="100%" flexDirection="column" marginTop={1}>
          <text content={t`${fg(theme.comment)("Result:")}`} />
          <text content={resultDisplay} />
        </box>
      )}

      {toolCall.status === "error" && errorDisplay && (
        <box width="100%" flexDirection="column" marginTop={1}>
          <text content={t`${fg(theme.red)(`Error: ${errorDisplay}`)}`} />
        </box>
      )}

      {toolCall.status === "denied" && (
        <box width="100%" marginTop={1}>
          <text content={t`${fg(theme.red)("Tool call was denied by user")}`} />
        </box>
      )}
    </box>
  );
}
