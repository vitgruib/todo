import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Todo } from '../types';

type ChatRole = 'assistant' | 'user';

interface ChatMessage {
    id: string;
    role: ChatRole;
    text: string;
}

interface StoredChatResult {
    requestId: string;
    ok: boolean;
    text?: string;
    error?: string;
    completedAt: number;
}

interface PersistedChatState {
    statusMessage: string;
    messages: ChatMessage[];
    pendingRequestId: string | null;
}

interface CompanionFrameProps {
    todos: Todo[];
}

const CHAT_STORAGE_KEY = 'todo_ai_companion_chat_v1';
const CHAT_RESULTS_KEY = 'todo-ai-chat-results';
const CHAT_REQUEST_MESSAGE_TYPE = 'todo-ai-chat-request';
const CHAT_RESULTS_LOCAL_FALLBACK_KEY = 'todo_ai_companion_chat_results_v1';
const INITIAL_ASSISTANT_TEXT = 'AI is served by your hosted backend proxy.';
const PROXY_URL = 'https://todo-cl9u.onrender.com/api/chat';
const MAX_TODO_CONTEXT_ITEMS = 60;

const createId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const DEFAULT_MESSAGES: ChatMessage[] = [{ id: createId(), role: 'assistant', text: INITIAL_ASSISTANT_TEXT }];

const parseJson = (raw: string): unknown => {
    try {
        return JSON.parse(raw);
    } catch {
        return null;
    }
};

const buildTodoContext = (todos: Todo[]) => {
    const now = new Date().toISOString();
    const totalCount = todos.length;
    const completedCount = todos.filter((todo) => todo.completed).length;
    const openCount = totalCount - completedCount;

    const items = todos.slice(0, MAX_TODO_CONTEXT_ITEMS).map((todo) => ({
        title: todo.title,
        completed: todo.completed,
        deadline: todo.deadline ?? null,
        steps: todo.steps.map((step) => ({
            title: step.title,
            completed: step.completed,
        })),
    }));

    return {
        generatedAt: now,
        totalCount,
        openCount,
        completedCount,
        items,
    };
};

const formatErrorForChat = (error: unknown, proxyUrl: string): string => {
    const lines: string[] = ['Gemini request failed.', `endpoint: ${proxyUrl}`, `time: ${new Date().toISOString()}`];

    if (typeof navigator !== 'undefined') {
        lines.push(`navigator.onLine: ${String(navigator.onLine)}`);
    }

    if (error instanceof Error) {
        lines.push(`name: ${error.name}`);
        lines.push(`message: ${error.message}`);

        const maybeCause = (error as Error & { cause?: unknown }).cause;
        if (maybeCause) {
            lines.push(`cause: ${String(maybeCause)}`);
        }

        if (typeof error.stack === 'string' && error.stack.trim().length > 0) {
            lines.push('stack:');
            lines.push(error.stack);
        }
    } else {
        lines.push(`thrown: ${String(error)}`);
    }

    return lines.join('\n');
};

const getExtensionStorage = (): {
    get: (keys: string[] | string, callback: (items: Record<string, unknown>) => void) => void;
    set: (items: Record<string, unknown>, callback?: () => void) => void;
    onChanged?: {
        addListener: (callback: (changes: Record<string, unknown>, areaName: string) => void) => void;
        removeListener: (callback: (changes: Record<string, unknown>, areaName: string) => void) => void;
    };
} | null => {
    const chromeApi = (globalThis as { chrome?: unknown }).chrome as
        | {
              storage?: {
                  local?: {
                      get: (keys: string[] | string, callback: (items: Record<string, unknown>) => void) => void;
                      set: (items: Record<string, unknown>, callback?: () => void) => void;
                  };
                  onChanged?: {
                      addListener: (
                          callback: (changes: Record<string, unknown>, areaName: string) => void
                      ) => void;
                      removeListener: (
                          callback: (changes: Record<string, unknown>, areaName: string) => void
                      ) => void;
                  };
              };
          }
        | undefined;

    if (!chromeApi?.storage?.local) {
        return null;
    }

    return {
        get: chromeApi.storage.local.get.bind(chromeApi.storage.local),
        set: chromeApi.storage.local.set.bind(chromeApi.storage.local),
        onChanged: chromeApi.storage.onChanged,
    };
};

const getExtensionRuntime = (): {
    sendMessage: (message: unknown, responseCallback?: (response?: { ok?: boolean; error?: string }) => void) => void;
    lastError?: { message?: string };
} | null => {
    const chromeApi = (globalThis as { chrome?: unknown }).chrome as
        | {
              runtime?: {
                  sendMessage: (
                      message: unknown,
                      responseCallback?: (response?: { ok?: boolean; error?: string }) => void
                  ) => void;
                  lastError?: { message?: string };
              };
          }
        | undefined;

    if (!chromeApi?.runtime?.sendMessage) {
        return null;
    }

    return chromeApi.runtime;
};

const sanitizePersistedState = (raw: unknown): PersistedChatState | null => {
    if (!raw || typeof raw !== 'object') {
        return null;
    }

    const candidate = raw as { statusMessage?: unknown; messages?: unknown; pendingRequestId?: unknown };
    if (typeof candidate.statusMessage !== 'string' || !Array.isArray(candidate.messages)) {
        return null;
    }

    const messages = candidate.messages
        .map((message) => {
            if (!message || typeof message !== 'object') {
                return null;
            }

            const item = message as { id?: unknown; role?: unknown; text?: unknown };
            if ((item.role !== 'assistant' && item.role !== 'user') || typeof item.text !== 'string') {
                return null;
            }

            return {
                id: typeof item.id === 'string' ? item.id : createId(),
                role: item.role,
                text: item.text,
            } as ChatMessage;
        })
        .filter((message): message is ChatMessage => Boolean(message))
        .slice(-100);

    const pendingRequestId = typeof candidate.pendingRequestId === 'string' ? candidate.pendingRequestId : null;

    return {
        statusMessage: candidate.statusMessage,
        messages: messages.length > 0 ? messages : DEFAULT_MESSAGES,
        pendingRequestId,
    };
};

const sanitizeChatResults = (raw: unknown): Record<string, StoredChatResult> => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return {};
    }

    const source = raw as Record<string, unknown>;
    const output: Record<string, StoredChatResult> = {};

    for (const [key, value] of Object.entries(source)) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            continue;
        }

        const item = value as {
            requestId?: unknown;
            ok?: unknown;
            text?: unknown;
            error?: unknown;
            completedAt?: unknown;
        };

        if (typeof item.requestId !== 'string' || item.requestId !== key || typeof item.ok !== 'boolean') {
            continue;
        }

        output[key] = {
            requestId: item.requestId,
            ok: item.ok,
            text: typeof item.text === 'string' ? item.text : undefined,
            error: typeof item.error === 'string' ? item.error : undefined,
            completedAt: typeof item.completedAt === 'number' ? item.completedAt : 0,
        };
    }

    return output;
};

const readPersistedChatState = async (): Promise<PersistedChatState | null> => {
    const storage = getExtensionStorage();
    if (storage) {
        return new Promise((resolve) => {
            storage.get([CHAT_STORAGE_KEY], (items) => {
                resolve(sanitizePersistedState(items?.[CHAT_STORAGE_KEY]));
            });
        });
    }

    try {
        const raw = localStorage.getItem(CHAT_STORAGE_KEY);
        return sanitizePersistedState(raw ? parseJson(raw) : null);
    } catch {
        return null;
    }
};

const persistChatState = (state: PersistedChatState): void => {
    const toStore: PersistedChatState = {
        statusMessage: state.statusMessage,
        messages: state.messages.slice(-100),
        pendingRequestId: state.pendingRequestId,
    };

    const storage = getExtensionStorage();
    if (storage) {
        storage.set({ [CHAT_STORAGE_KEY]: toStore });
        return;
    }

    try {
        localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(toStore));
    } catch {
        // Ignore persistence errors.
    }
};

const readStoredChatResults = async (): Promise<Record<string, StoredChatResult>> => {
    const storage = getExtensionStorage();
    if (storage) {
        return new Promise((resolve) => {
            storage.get([CHAT_RESULTS_KEY], (items) => {
                resolve(sanitizeChatResults(items?.[CHAT_RESULTS_KEY]));
            });
        });
    }

    try {
        const raw = localStorage.getItem(CHAT_RESULTS_LOCAL_FALLBACK_KEY);
        return sanitizeChatResults(raw ? parseJson(raw) : null);
    } catch {
        return {};
    }
};

const writeStoredChatResults = async (results: Record<string, StoredChatResult>): Promise<void> => {
    const storage = getExtensionStorage();
    if (storage) {
        return new Promise((resolve) => {
            storage.set({ [CHAT_RESULTS_KEY]: results }, () => resolve());
        });
    }

    try {
        localStorage.setItem(CHAT_RESULTS_LOCAL_FALLBACK_KEY, JSON.stringify(results));
    } catch {
        // Ignore persistence errors.
    }
};

const consumeStoredChatResult = async (requestId: string): Promise<StoredChatResult | null> => {
    const allResults = await readStoredChatResults();
    const result = allResults[requestId];
    if (!result) {
        return null;
    }

    delete allResults[requestId];
    await writeStoredChatResults(allResults);
    return result;
};

export const CompanionFrame: React.FC<CompanionFrameProps> = ({ todos }) => {
    const [statusMessage, setStatusMessage] = useState<string>('Gemini proxy mode enabled.');
    const [input, setInput] = useState<string>('');
    const [messages, setMessages] = useState<ChatMessage[]>(DEFAULT_MESSAGES);
    const [pendingRequestId, setPendingRequestId] = useState<string | null>(null);
    const [isHydrated, setIsHydrated] = useState<boolean>(false);

    const messagesEndRef = useRef<HTMLDivElement | null>(null);
    const isSending = pendingRequestId !== null;

    useEffect(() => {
        let cancelled = false;

        const hydrate = async () => {
            const persisted = await readPersistedChatState();
            if (cancelled) {
                return;
            }

            if (persisted) {
                setMessages(persisted.messages);
                setStatusMessage(persisted.statusMessage);
                setPendingRequestId(persisted.pendingRequestId);
            }

            setIsHydrated(true);
        };

        void hydrate();

        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(() => {
        if (!isHydrated) {
            return;
        }

        persistChatState({ messages, statusMessage, pendingRequestId });
    }, [isHydrated, messages, pendingRequestId, statusMessage]);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages, statusMessage]);

    const applyCompletedResult = useCallback(
        (result: StoredChatResult) => {
            if (result.ok) {
                const text = typeof result.text === 'string' && result.text.trim().length > 0
                    ? result.text.trim()
                    : 'Proxy returned an empty response.';
                setMessages((prev) => [...prev, { id: createId(), role: 'assistant', text }]);
                setStatusMessage('Gemini proxy connected.');
                setPendingRequestId((current) => (current === result.requestId ? null : current));
                return;
            }

            const error = new Error(result.error || 'Unknown background chat error');
            setMessages((prev) => [
                ...prev,
                {
                    id: createId(),
                    role: 'assistant',
                    text: formatErrorForChat(error, PROXY_URL),
                },
            ]);
            setStatusMessage(`Gemini proxy error: ${error.message}`);
            setPendingRequestId((current) => (current === result.requestId ? null : current));
        },
        []
    );

    const consumePendingResult = useCallback(
        async (requestId: string) => {
            const result = await consumeStoredChatResult(requestId);
            if (!result) {
                return;
            }

            applyCompletedResult(result);
        },
        [applyCompletedResult]
    );

    useEffect(() => {
        if (!isHydrated || !pendingRequestId) {
            return;
        }

        void consumePendingResult(pendingRequestId);
    }, [consumePendingResult, isHydrated, pendingRequestId]);

    useEffect(() => {
        const storage = getExtensionStorage();
        if (!storage?.onChanged) {
            return;
        }

        const onStorageChanged = (changes: Record<string, unknown>, areaName: string) => {
            if (areaName !== 'local' || !changes[CHAT_RESULTS_KEY] || !pendingRequestId) {
                return;
            }

            void consumePendingResult(pendingRequestId);
        };

        storage.onChanged.addListener(onStorageChanged);
        return () => {
            storage.onChanged?.removeListener(onStorageChanged);
        };
    }, [consumePendingResult, pendingRequestId]);

    const statusLabel = useMemo(() => {
        if (isSending) {
            return 'Gemini proxy: generating response...';
        }
        return statusMessage;
    }, [isSending, statusMessage]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const prompt = input.trim();
        if (!prompt || isSending) {
            return;
        }

        const requestId = createId();
        const userMessage: ChatMessage = { id: createId(), role: 'user', text: prompt };
        const nextMessages = [...messages, userMessage];
        const history = nextMessages
            .filter((message) => message.text.trim().length > 0)
            .slice(-10)
            .map((message) => ({ role: message.role, text: message.text }));
        const todoContext = buildTodoContext(todos);

        setMessages(nextMessages);
        setInput('');
        setPendingRequestId(requestId);
        setStatusMessage('Gemini proxy: generating response...');

        if (isHydrated) {
            persistChatState({
                messages: nextMessages,
                statusMessage: 'Gemini proxy: generating response...',
                pendingRequestId: requestId,
            });
        }

        const runtime = getExtensionRuntime();
        if (runtime?.sendMessage) {
            runtime.sendMessage(
                {
                    type: CHAT_REQUEST_MESSAGE_TYPE,
                    requestId,
                    proxyUrl: PROXY_URL,
                    messages: history,
                    todoContext,
                },
                (response) => {
                    const runtimeError = chrome.runtime?.lastError;
                    if (runtimeError?.message) {
                        const error = new Error(runtimeError.message);
                        setMessages((prev) => [
                            ...prev,
                            {
                                id: createId(),
                                role: 'assistant',
                                text: formatErrorForChat(error, PROXY_URL),
                            },
                        ]);
                        setStatusMessage(`Gemini proxy error: ${runtimeError.message}`);
                        setPendingRequestId((current) => (current === requestId ? null : current));
                        return;
                    }

                    if (response?.ok === false && response.error === 'Invalid chat request payload.') {
                        const error = new Error(response.error);
                        setMessages((prev) => [
                            ...prev,
                            {
                                id: createId(),
                                role: 'assistant',
                                text: formatErrorForChat(error, PROXY_URL),
                            },
                        ]);
                        setStatusMessage(`Gemini proxy error: ${response.error}`);
                        setPendingRequestId((current) => (current === requestId ? null : current));
                    }
                }
            );

            return;
        }

        try {
            const response = await fetch(PROXY_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ messages: history, todoContext }),
            });

            const rawText = await response.text();
            const payload = parseJson(rawText) as { error?: string; text?: string } | null;

            if (!response.ok) {
                const errorDetail =
                    payload?.error ||
                    rawText.trim() ||
                    `Proxy request failed (${response.status} ${response.statusText})`;
                throw new Error(`HTTP ${response.status} ${response.statusText}: ${errorDetail}`);
            }

            const output =
                typeof payload?.text === 'string'
                    ? payload.text.trim()
                    : typeof rawText === 'string'
                      ? rawText.trim()
                      : '';
            setMessages((prev) => [
                ...prev,
                {
                    id: createId(),
                    role: 'assistant',
                    text: output || 'Proxy returned an empty response.',
                },
            ]);
            setStatusMessage('Gemini proxy connected.');
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            setMessages((prev) => [
                ...prev,
                {
                    id: createId(),
                    role: 'assistant',
                    text: formatErrorForChat(error, PROXY_URL),
                },
            ]);
            setStatusMessage(`Gemini proxy error: ${message || 'Unknown proxy error'}`);
        } finally {
            setPendingRequestId((current) => (current === requestId ? null : current));
        }
    };

    return (
        <div className="companion-frame">
            <div className="companion-chat">
                <div className="companion-chat-header">
                    <h3>AI Companion</h3>
                    <p>{statusLabel}</p>
                </div>

                <div className="companion-chat-messages">
                    {messages.map((message) => (
                        <div
                            key={message.id}
                            className={`chat-bubble ${message.role === 'user' ? 'user' : 'assistant'}`}
                        >
                            {message.text}
                        </div>
                    ))}
                    {isSending && <div className="chat-bubble assistant">Thinking...</div>}
                    <div ref={messagesEndRef} />
                </div>

                <form className="companion-chat-input" onSubmit={handleSubmit}>
                    <textarea
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        placeholder="Ask Todo AI..."
                        rows={2}
                        disabled={isSending}
                    />
                    <button type="submit" disabled={!input.trim() || isSending}>
                        Send
                    </button>
                </form>
            </div>
        </div>
    );
};
