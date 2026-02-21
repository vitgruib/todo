import React, { useEffect, useMemo, useRef, useState } from 'react';

type ChatRole = 'assistant' | 'user';

interface ChatMessage {
    id: string;
    role: ChatRole;
    text: string;
}

const CHAT_STORAGE_KEY = 'todo_ai_companion_chat_v1';
const INITIAL_ASSISTANT_TEXT = 'AI is served by your backend proxy. Start the proxy server to chat.';

const createId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const DEFAULT_MESSAGES: ChatMessage[] = [{ id: createId(), role: 'assistant', text: INITIAL_ASSISTANT_TEXT }];

interface PersistedChatState {
    statusMessage: string;
    messages: ChatMessage[];
}

const parseJson = (raw: string): unknown => {
    try {
        return JSON.parse(raw);
    } catch {
        return null;
    }
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
} | null => {
    const chromeApi = (globalThis as { chrome?: unknown }).chrome as
        | {
              storage?: {
                  local?: {
                      get: (keys: string[] | string, callback: (items: Record<string, unknown>) => void) => void;
                      set: (items: Record<string, unknown>, callback?: () => void) => void;
                  };
              };
          }
        | undefined;

    if (!chromeApi?.storage?.local) {
        return null;
    }

    return chromeApi.storage.local;
};

const sanitizePersistedState = (raw: unknown): PersistedChatState | null => {
    if (!raw || typeof raw !== 'object') {
        return null;
    }

    const candidate = raw as { statusMessage?: unknown; messages?: unknown };
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

    return {
        statusMessage: candidate.statusMessage,
        messages: messages.length > 0 ? messages : DEFAULT_MESSAGES,
    };
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

interface CompanionFrameProps {
    proxyUrl: string;
}

export const CompanionFrame: React.FC<CompanionFrameProps> = ({ proxyUrl }) => {
    const [statusMessage, setStatusMessage] = useState<string>('Gemini proxy mode enabled.');
    const [input, setInput] = useState<string>('');
    const [isSending, setIsSending] = useState<boolean>(false);
    const [messages, setMessages] = useState<ChatMessage[]>(DEFAULT_MESSAGES);
    const [isHydrated, setIsHydrated] = useState<boolean>(false);

    const messagesEndRef = useRef<HTMLDivElement | null>(null);

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

        persistChatState({ messages, statusMessage });
    }, [isHydrated, messages, statusMessage]);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages, statusMessage]);

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

        const userMessage: ChatMessage = { id: createId(), role: 'user', text: prompt };
        const nextMessages = [...messages, userMessage];
        const history = nextMessages
            .filter((message) => message.text.trim().length > 0)
            .slice(-10)
            .map((message) => ({ role: message.role, text: message.text }));

        setMessages(nextMessages);
        setInput('');
        setIsSending(true);

        try {
            const response = await fetch(proxyUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ messages: history }),
            });

            const rawText = await response.text();
            const payload = parseJson(rawText) as { error?: string; text?: string } | null;

            if (!response.ok) {
                const errorDetail =
                    payload?.error ||
                    rawText.trim() ||
                    `Proxy request failed (${response.status} ${response.statusText})`;
                const errorMessage = `HTTP ${response.status} ${response.statusText}: ${errorDetail}`;
                throw new Error(errorMessage);
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
            console.error('Proxy prompt failed:', error);
            const errorText = formatErrorForChat(error, proxyUrl);
            const message = error instanceof Error ? error.message : String(error);
            setStatusMessage(`Gemini proxy error: ${message || 'Unknown proxy error'}`);
            setMessages((prev) => [
                ...prev,
                {
                    id: createId(),
                    role: 'assistant',
                    text: errorText,
                },
            ]);
        } finally {
            setIsSending(false);
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
