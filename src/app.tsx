import { useMemo, useState } from "react";
import { useKeyboard, useTerminalDimensions, useRenderer } from "@opentui/react";
import { theme, colors } from "@/theme";
import { MessageView } from "@/components/MessageView";
import { ToolCallView } from "@/components/ToolCallView";
import { StatusBar } from "@/components/StatusBar";
import { CommandPalette } from "@/components/CommandPalette";
import { ApprovalPrompt } from "@/components/ApprovalPrompt";
import { ApiKeyPrompt } from "@/components/ApiKeyPrompt";
import { WelcomeScreen } from "@/components/WelcomeScreen";
import { Indicator } from "@/components/Indicator";
import { useAgentSession } from "@/hooks/useAgentSession";
import type { ToolCall } from "@/types";

export function App() {
  const renderer = useRenderer();
  const { width: termWidth, height: termHeight } = useTerminalDimensions();
  const [showPalette, setShowPalette] = useState(false);

  const session = useAgentSession();

  const isInputActive = !showPalette && !session.pendingApproval && !session.showApiKeyPrompt;
  const cols = termWidth || 80;
  const rows = termHeight || 24;
  const sidebarWidth = Math.max(25, Math.floor(cols * 0.2));
  const mainWidth = cols - sidebarWidth;
  const showWelcome = session.messages.length === 0;
  const reservedRows = session.pendingApproval ? 16 : showWelcome ? 13 : 6;
  const availableRows = Math.max(7, rows - reservedRows);

  useKeyboard((key) => {
    if (session.showApiKeyPrompt && key.name === "escape") {
      renderer.destroy();
      process.exit(0);
    }

    if (key.ctrl && key.name === "k" && !showPalette && !session.pendingApproval && !session.showApiKeyPrompt) {
      void session.refreshSessions();
      setShowPalette(true);
      return;
    }

    if (key.name === "escape" && !showPalette && !session.pendingApproval && !session.showApiKeyPrompt) {
      if (!session.cancelActiveTurn() && !session.isBusy) {
        renderer.destroy();
        process.exit(0);
      }
      return;
    }
  });

  const visibleMessages = useMemo(() => {
    return session.messages.slice(-10);
  }, [session.messages]);

  const toolCallsByMessageIndex = useMemo(() => {
    const map = new Map<number, ToolCall[]>();
    session.toolCalls.forEach((tc) => {
      const idx = tc.assistantMessageIndex;
      if (!map.has(idx)) map.set(idx, []);
      map.get(idx)!.push(tc);
    });
    return map;
  }, [session.toolCalls]);

  const streamingMessage =
    session.streaming && session.streamText
      ? { role: "assistant" as const, content: session.streamText }
      : undefined;
  const orphanToolCalls = toolCallsByMessageIndex.get(-1) ?? [];

  return (
    <box
      width={cols}
      height={rows}
      backgroundColor={colors.bgDark}
      flexDirection="row"
    >
      <box
        width={mainWidth}
        height="100%"
        backgroundColor={colors.bgDark}
        flexDirection="column"
      >
        {showWelcome ? (
          <WelcomeScreen />
        ) : (
          <box width="100%" flexGrow={1} paddingX={1} paddingY={1}>
            <scrollbox
              width={mainWidth - 2}
              height={availableRows - 1}
              scrollY={true}
              stickyScroll={true}
              stickyStart="bottom"
              viewportCulling={true}
            >
              {visibleMessages.map((msg, i) => {
                const actualIndex = session.messages.length - visibleMessages.length + i;
                const nextMessage = session.messages[actualIndex + 1];
                const activeTurnToolCalls =
                  msg.role === "user" && nextMessage?.role !== "assistant"
                    ? toolCallsByMessageIndex.get(actualIndex + 1) ?? []
                    : [];
                return (
                  <box key={`${actualIndex}-${msg.role}`} flexDirection="column" marginY={0.5}>
                    <MessageView msg={msg} width={mainWidth - 4} />
                    {activeTurnToolCalls.map((tc) => (
                      <ToolCallView key={tc.id} toolCall={tc} />
                    ))}
                    {msg.role === "assistant" &&
                      toolCallsByMessageIndex.get(actualIndex)?.map((tc) => (
                        <ToolCallView key={tc.id} toolCall={tc} />
                      ))}
                  </box>
                );
              })}

              {streamingMessage && (
                <MessageView msg={streamingMessage} width={mainWidth - 4} isStreaming={true} />
              )}

              {orphanToolCalls.map((tc) => (
                <ToolCallView key={tc.id} toolCall={tc} />
              ))}

            </scrollbox>
          </box>
        )}

        <box
          width={mainWidth - 2}
          flexDirection="column"
          backgroundColor={colors.bg}
          paddingX={2}
          marginX={1}
          border={["left"]}
          borderStyle="heavy"
          borderColor={theme.purple}
        >
          {session.pendingApproval ? (
            <ApprovalPrompt
              toolName={session.pendingApproval.toolName}
              args={session.pendingApproval.args}
              onRespond={session.respondToApproval}
            />
          ) : (
            <box width="100%" flexDirection="row" height={3} justifyContent="center" alignItems="center">
              <text>
                <strong fg={theme.purple}>❯ </strong>
              </text>
              <input
                placeholder="Ask anything..."
                value={session.input}
                onInput={session.setInput}
                onSubmit={() => session.handleSubmit(session.input)}
                focused={isInputActive}
                width={"100%"}
                backgroundColor={colors.bg}
                textColor={colors.fg}
                cursorColor={colors.purple}
              />
            </box>
          )}

          <box width="100%" flexDirection="row" gap={1} paddingBottom={1}>
            <text><strong fg={theme.blue}>{session.selectedModel}</strong></text>
            {session.streaming && (
              <Indicator />
            )}
          </box>
        </box>
      </box>

      <box
        width={sidebarWidth}
        height="100%"
        backgroundColor={colors.bg}
        paddingX={2}
        paddingY={1}
      >
        <StatusBar
          model={session.selectedModel}
          msgCount={session.messages.length}
          cumulativeTokens={session.cumulativeTokens}
        />
      </box>

      {showPalette && (
        <box
          position="absolute"
          width={cols}
          height={rows}
          justifyContent="center"
          alignItems="center"
          zIndex={100}
        >
          <CommandPalette
            totalTokens={session.cumulativeTokens.total}
            sessions={session.sessions}
            currentSessionId={session.currentSessionId}
            onClose={() => setShowPalette(false)}
            onNewSession={session.handleNewSession}
            onSwitchSession={session.handleSwitchSession}
            onChangeModel={session.setSelectedModel}
            onClearHistory={session.handleClearHistory}
            onShowWelcome={session.handleNewSession}
          />
        </box>
      )}

      {session.showApiKeyPrompt && (
        <box
          position="absolute"
          width={cols}
          height={rows}
          justifyContent="center"
          alignItems="center"
          zIndex={120}
        >
          <ApiKeyPrompt
            onSubmit={session.handleApiKeySubmit}
            saving={session.savingApiKey}
            error={session.apiKeyError}
          />
        </box>
      )}
    </box>
  );
}
