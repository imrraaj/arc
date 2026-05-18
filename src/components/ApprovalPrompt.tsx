import { useState } from "react";
import { useKeyboard } from "@opentui/react";
import { theme, colors } from "../theme";

interface ApprovalPromptProps {
  toolName: string;
  args: Record<string, unknown>;
  onRespond: (approved: boolean) => void;
}

export function ApprovalPrompt({ toolName, args, onRespond }: ApprovalPromptProps) {
  const [selectedOption, setSelectedOption] = useState<0 | 1>(0);

  useKeyboard((key) => {
    if (key.name === "up" || key.name === "down" || key.name === "left" || key.name === "right") {
      setSelectedOption((prev) => (prev === 0 ? 1 : 0));
      return;
    }
    if (key.name === "return") {
      onRespond(selectedOption === 0);
      return;
    }
    if (key.name === "escape") {
      onRespond(false);
    }
  });

  const argsDisplay = JSON.stringify(args, null, 2);
  const truncatedArgs = argsDisplay.length > 900 ? argsDisplay.slice(0, 900) + "\n... (truncated)" : argsDisplay;

  return (
    <box
      width="100%"
      paddingY={1}
      backgroundColor={colors.bg}
      flexDirection="column"
    >
      <box width="100%" flexDirection="row" gap={1}>
        <text fg={theme.yellow}>
          <strong>Permission</strong>
        </text>
        <text fg={theme.fg}>{toolName}</text>
      </box>

      <box width="100%" marginTop={1}>
        <text fg={theme.comment}>{truncatedArgs}</text>
      </box>

      <box width="100%" flexDirection="row" marginTop={1} gap={2}>
        <box
          backgroundColor={selectedOption === 0 ? theme.selection : undefined}
          paddingX={1}
        >
          <text fg={selectedOption === 0 ? theme.green : theme.comment}>
            <strong>{selectedOption === 0 ? "▸ " : "  "}</strong>
            approve
          </text>
        </box>
        <box
          backgroundColor={selectedOption === 1 ? theme.selection : undefined}
          paddingX={1}
        >
          <text fg={selectedOption === 1 ? theme.red : theme.comment}>
            <strong>{selectedOption === 1 ? "▸ " : "  "}</strong>
            deny
          </text>
        </box>
      </box>
    </box>
  );
}
