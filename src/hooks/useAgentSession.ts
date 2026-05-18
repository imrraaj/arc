import { useCallback, useEffect, useRef, useState } from "react";
import { runAgentTurn } from "@/agent";
import { config } from "@/utils/config";
import {
  clearSession,
  createSession,
  listSessions,
  loadSession,
  saveSession,
  type PersistedSession,
  type SessionMeta,
} from "@/storage/session-store";
import { loadSettings, saveSettings } from "@/utils/settings";
import type { Message, PendingApproval, ToolCall } from "@/types";

const ZERO_TOKENS = { input: 0, output: 0, total: 0 };

export function useAgentSession() {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [streamText, setStreamText] = useState("");
  const [cumulativeTokens, setCumulativeTokens] = useState(ZERO_TOKENS);
  const [selectedModel, setSelectedModel] = useState<string>(config.defaultModel);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [conversationSummary, setConversationSummary] = useState("");
  const [isCompacting, setIsCompacting] = useState(false);
  const [toolCalls, setToolCalls] = useState<ToolCall[]>([]);
  const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(null);
  const [nvidiaApiKey, setNvidiaApiKey] = useState<string | null>(null);
  const [apiKeyLoading, setApiKeyLoading] = useState(true);
  const [savingApiKey, setSavingApiKey] = useState(false);
  const [apiKeyError, setApiKeyError] = useState<string | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);

  const hydrateSession = useCallback((session: PersistedSession) => {
    setCurrentSessionId(session.id);
    setMessages(session.messages);
    setToolCalls(session.toolCalls);
    setSelectedModel(session.model ?? config.defaultModel);
    setConversationSummary(session.conversationSummary ?? "");
    setCumulativeTokens(session.cumulativeTokens ?? ZERO_TOKENS);
    setInput("");
    setStreamText("");
    setStreaming(false);
  }, []);

  const refreshSessions = useCallback(async () => {
    setSessions(await listSessions());
  }, []);

  const cancelActiveTurn = useCallback(() => {
    if (!abortControllerRef.current) return false;
    abortControllerRef.current.abort();
    abortControllerRef.current = null;
    return true;
  }, []);

  const askUserApproval = useCallback(
    (toolCall: {
      id: string;
      approvalId: string;
      name: string;
      args: Record<string, unknown>;
    }): Promise<boolean> =>
      new Promise((resolve) =>
        setPendingApproval({
          id: toolCall.id,
          approvalId: toolCall.approvalId,
          toolName: toolCall.name,
          args: toolCall.args,
          resolve,
        })
      ),
    []
  );

  useEffect(() => {
    loadSettings()
      .then((settings) => {
        const key = settings.nvidiaApiKey?.trim();
        if (key) setNvidiaApiKey(key);
      })
      .finally(() => {
        setApiKeyLoading(false);
      });

    loadSession().then(async (session) => {
      if (session) {
        hydrateSession(session);
      } else {
        const created = await createSession(config.defaultModel);
        if (created) hydrateSession(created);
      }
      await refreshSessions();
    });
  }, [hydrateSession, refreshSessions]);

  useEffect(() => {
    if (!currentSessionId) return;
    saveSession(
      currentSessionId,
      messages,
      toolCalls,
      selectedModel,
      conversationSummary,
      cumulativeTokens
    );
  }, [currentSessionId, messages, toolCalls, selectedModel, conversationSummary, cumulativeTokens]);

  const handleApiKeySubmit = useCallback(async (apiKey: string) => {
    setApiKeyError(null);
    setSavingApiKey(true);
    const ok = await saveSettings({ nvidiaApiKey: apiKey });
    if (!ok) {
      setApiKeyError(`Could not save key to ${config.ui.apiKeyStorageLabel}`);
      setSavingApiKey(false);
      return;
    }

    setNvidiaApiKey(apiKey);
    setSavingApiKey(false);
  }, []);

  const handleNewSession = useCallback(async () => {
    cancelActiveTurn();

    const created = await createSession(selectedModel);
    if (!created) return;
    hydrateSession(created);
    await refreshSessions();
  }, [cancelActiveTurn, hydrateSession, refreshSessions, selectedModel]);

  const handleSwitchSession = useCallback(
    async (sessionId: string) => {
      cancelActiveTurn();

      const loaded = await loadSession(sessionId);
      if (!loaded) return;
      hydrateSession(loaded);
      await refreshSessions();
    },
    [cancelActiveTurn, hydrateSession, refreshSessions]
  );

  const handleClearHistory = useCallback(async () => {
    if (!currentSessionId) return;

    setMessages([]);
    setToolCalls([]);
    setInput("");
    setConversationSummary("");
    setCumulativeTokens(ZERO_TOKENS);
    await clearSession(currentSessionId);
    await refreshSessions();
  }, [currentSessionId, refreshSessions]);

  const handleSubmit = useCallback(
    async (prompt: string) => {
      const trimmedPrompt = prompt.trim();
      if (!trimmedPrompt || streaming || isCompacting || !nvidiaApiKey || !currentSessionId) return;

      const userMsg: Message = { role: "user", content: trimmedPrompt };
      const newMessages = [...messages, userMsg];
      setMessages(newMessages);
      setInput("");
      setStreaming(true);
      setStreamText("");

      abortControllerRef.current = new AbortController();

      try {
        await runAgentTurn({
          prompt: trimmedPrompt,
          messages,
          messagesWithPrompt: newMessages,
          selectedModel,
          nvidiaApiKey,
          conversationSummary,
          abortSignal: abortControllerRef.current.signal,
          askUserApproval,
          onMessagesChange: setMessages,
          onToolCallsChange: setToolCalls,
          onStreamText: setStreamText,
          onCompactingChange: setIsCompacting,
          onConversationSummary: setConversationSummary,
          onUsage: (usage) => {
            setCumulativeTokens((prev) => ({
              input: prev.input + (usage?.inputTokens ?? 0),
              output: prev.output + (usage?.outputTokens ?? 0),
              total: prev.total + (usage?.totalTokens ?? 0),
            }));
          },
        });
      } finally {
        setStreaming(false);
        setStreamText("");
        abortControllerRef.current = null;
      }
    },
    [
      messages,
      streaming,
      isCompacting,
      nvidiaApiKey,
      currentSessionId,
      selectedModel,
      conversationSummary,
      askUserApproval,
    ]
  );

  const respondToApproval = useCallback((approved: boolean) => {
    pendingApproval?.resolve(approved);
    setPendingApproval(null);
  }, [pendingApproval]);

  return {
    input,
    setInput,
    messages,
    streaming,
    streamText,
    cumulativeTokens,
    selectedModel,
    setSelectedModel,
    currentSessionId,
    sessions,
    refreshSessions,
    isCompacting,
    toolCalls,
    pendingApproval,
    showApiKeyPrompt: !apiKeyLoading && !nvidiaApiKey,
    savingApiKey,
    apiKeyError,
    isBusy: streaming || isCompacting,
    cancelActiveTurn,
    handleApiKeySubmit,
    handleNewSession,
    handleSwitchSession,
    handleClearHistory,
    handleSubmit,
    respondToApproval,
  };
}
