import React, { useCallback, useEffect, useRef, useState } from 'react';
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
    personality: 'normal' | 'endearing' | 'caustic';
    focusBumpAfterHours: number;
    onAddTodo: (title: string, deadline?: string) => void;
    onToggleTodo: (id: string) => void;
    onUpdateTodo: (id: string, updates: Partial<Todo>) => void;
}

const CHAT_STORAGE_KEY = 'todo_ai_companion_chat_v2';
const CHAT_RESULTS_KEY = 'todo-ai-chat-results-v2';
const TASK_CHECKIN_REQUEST_KEY = 'todo-ai-task-checkin-request-v1';
const CHAT_REQUEST_MESSAGE_TYPE = 'todo-ai-chat-request';
const CHAT_CANCEL_MESSAGE_TYPE = 'todo-ai-chat-cancel';
const CHAT_RESULTS_LOCAL_FALLBACK_KEY = 'todo_ai_companion_chat_results_v2';
const COMPLETION_REACTION_COOLDOWN_MS = 7_000;
const INITIAL_ASSISTANT_TEXT =
    "Hi, I'm Todo, your companion. I can help you prioritize tasks and keep momentum.";
const PROXY_URL = 'https://todo-cl9u.onrender.com/api/chat';
const MAX_TODO_CONTEXT_ITEMS = 60;

type ActionType = 'add_todo' | 'complete_todo' | 'delay_todo';

interface ActionProposal {
    type: ActionType;
    reason?: string;
    todoId?: string;
    todoTitle?: string;
    title?: string;
    deadline?: string;
}

interface ParsedAssistantPayload {
    text: string;
    actionProposal: ActionProposal | null;
}

const createId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const DEFAULT_MESSAGES: ChatMessage[] = [{ id: createId(), role: 'assistant', text: INITIAL_ASSISTANT_TEXT }];

const parseJson = (raw: string): unknown => {
    try {
        return JSON.parse(raw);
    } catch {
        return null;
    }
};

const extractJsonBlock = (raw: string): string | null => {
    const fencedMatch = raw.match(/```json\s*([\s\S]*?)```/i);
    if (fencedMatch?.[1]) {
        return fencedMatch[1].trim();
    }
    return null;
};

const normalizeActionProposal = (value: unknown): ActionProposal | null => {
    if (!value || typeof value !== 'object') {
        return null;
    }
    const candidate = value as Record<string, unknown>;
    const type = candidate.type;
    if (type !== 'add_todo' && type !== 'complete_todo' && type !== 'delay_todo') {
        return null;
    }
    return {
        type,
        reason: typeof candidate.reason === 'string' ? candidate.reason : undefined,
        todoId: typeof candidate.todoId === 'string' ? candidate.todoId : undefined,
        todoTitle: typeof candidate.todoTitle === 'string' ? candidate.todoTitle : undefined,
        title: typeof candidate.title === 'string' ? candidate.title : undefined,
        deadline: typeof candidate.deadline === 'string' ? candidate.deadline : undefined,
    };
};

const parseAssistantTextAndAction = (rawText: string): ParsedAssistantPayload => {
    const trimmed = rawText.trim();
    const jsonBlock = extractJsonBlock(trimmed);
    if (!jsonBlock) {
        return { text: trimmed, actionProposal: null };
    }

    const parsed = parseJson(jsonBlock);
    if (!parsed || typeof parsed !== 'object') {
        return { text: trimmed, actionProposal: null };
    }

    const payload = parsed as { message?: unknown; actionProposal?: unknown };
    const actionProposal = normalizeActionProposal(payload.actionProposal);
    const message = typeof payload.message === 'string' ? payload.message.trim() : '';

    const withoutBlock = trimmed.replace(/```json[\s\S]*?```/i, '').trim();
    const finalMessage = message || withoutBlock || 'Got it.';
    return {
        text: finalMessage,
        actionProposal,
    };
};

const toLocalDateOnly = (date: Date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

/** Hard-coded, clear description for each action type shown when asking the user to confirm. */
function getActionConfirmDescription(
    proposal: ActionProposal,
    resolveTodo: (p: ActionProposal) => Todo | null
): string {
    switch (proposal.type) {
        case 'add_todo':
            if (!proposal.title) return 'Add a new task (details missing).';
            return proposal.deadline
                ? `Add a new task: "${proposal.title}" with deadline ${proposal.deadline}.`
                : `Add a new task: "${proposal.title}".`;
        case 'complete_todo': {
            const todo = resolveTodo(proposal);
            return todo ? `Mark task "${todo.title}" as complete.` : 'Mark a task as complete (task not found).';
        }
        case 'delay_todo': {
            if (!proposal.deadline) return 'Move a task to another date (date missing).';
            const todo = resolveTodo(proposal);
            return todo
                ? `Move task "${todo.title}" to ${proposal.deadline}.`
                : `Move a task to ${proposal.deadline} (task not found).`;
        }
        default:
            return 'Apply this change to your list.';
    }
}

const getTodoCategory = (deadline?: string): 'focus' | 'up-next' | 'someday' => {
    if (!deadline) {
        return 'someday';
    }

    const today = toLocalDateOnly(new Date());
    if (deadline <= today) {
        return 'focus';
    }

    const tomorrowDate = new Date();
    tomorrowDate.setDate(tomorrowDate.getDate() + 1);
    const tomorrow = toLocalDateOnly(tomorrowDate);
    if (deadline === tomorrow) {
        return 'up-next';
    }

    return 'someday';
};

const buildTodoContext = (todos: Todo[], personality: 'normal' | 'endearing' | 'caustic') => {
    const now = new Date().toISOString();
    const totalCount = todos.length;
    const completedCount = todos.filter((todo) => todo.completed).length;
    const openCount = totalCount - completedCount;

    const items = todos.slice(0, MAX_TODO_CONTEXT_ITEMS).map((todo) => {
        const category = getTodoCategory(todo.deadline);
        const item: { title: string; completed: boolean; category: 'focus' | 'up-next' | 'someday'; deadline?: string } = {
            title: todo.title,
            completed: todo.completed,
            category,
        };
        if (category === 'focus' && typeof todo.deadline === 'string' && todo.deadline.trim().length > 0) {
            item.deadline = todo.deadline.trim();
        }
        return item;
    });

    const categoryCounts = items.reduce(
        (acc, item) => {
            acc[item.category] += 1;
            return acc;
        },
        { focus: 0, 'up-next': 0, someday: 0 }
    );

    return {
        generatedAt: now,
        personality,
        totalCount,
        openCount,
        completedCount,
        categoryCounts,
        items,
    };
};

const formatErrorForChat = (error: unknown, proxyUrl: string): string => {
    const lines: string[] = ['Gemma request failed.', `endpoint: ${proxyUrl}`, `time: ${new Date().toISOString()}`];

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

const clearPersistedChatState = async (): Promise<void> => {
    const storage = getExtensionStorage();
    if (storage) {
        return new Promise((resolve) => {
            storage.set(
                {
                    [CHAT_STORAGE_KEY]: {
                        statusMessage: 'Gemma proxy mode enabled.',
                        messages: DEFAULT_MESSAGES,
                        pendingRequestId: null,
                    },
                    [CHAT_RESULTS_KEY]: {},
                },
                () => resolve()
            );
        });
    }

    try {
        localStorage.removeItem(CHAT_STORAGE_KEY);
        localStorage.setItem(CHAT_RESULTS_LOCAL_FALLBACK_KEY, JSON.stringify({}));
    } catch {
        // Ignore persistence errors.
    }
};

export const CompanionFrame: React.FC<CompanionFrameProps> = ({
    todos,
    personality,
    focusBumpAfterHours,
    onAddTodo,
    onToggleTodo,
    onUpdateTodo,
}) => {
    const [statusMessage, setStatusMessage] = useState<string>('Gemma proxy mode enabled.');
    const [input, setInput] = useState<string>('');
    const [messages, setMessages] = useState<ChatMessage[]>(DEFAULT_MESSAGES);
    const [pendingRequestId, setPendingRequestId] = useState<string | null>(null);
    const [isHydrated, setIsHydrated] = useState<boolean>(false);
    const [isMenuOpen, setIsMenuOpen] = useState<boolean>(false);
    const [pendingActionProposal, setPendingActionProposal] = useState<ActionProposal | null>(null);

    const messagesEndRef = useRef<HTMLDivElement | null>(null);
    const menuRef = useRef<HTMLDivElement | null>(null);
    const completionSnapshotRef = useRef<Map<string, boolean>>(new Map());
    const lastCompletionReactionAtRef = useRef<number>(0);
    const lastBumpCheckAtRef = useRef<number>(0);
    const BUMP_CHECK_COOLDOWN_MS = 30_000;
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

    useEffect(() => {
        if (!isMenuOpen) {
            return;
        }

        const onPointerDown = (event: MouseEvent) => {
            const target = event.target;
            if (!(target instanceof Node)) {
                return;
            }

            if (!menuRef.current?.contains(target)) {
                setIsMenuOpen(false);
            }
        };

        document.addEventListener('mousedown', onPointerDown);
        return () => {
            document.removeEventListener('mousedown', onPointerDown);
        };
    }, [isMenuOpen]);

    const applyCompletedResult = useCallback(
        (result: StoredChatResult) => {
            if (result.ok) {
                const rawText = typeof result.text === 'string' && result.text.trim().length > 0
                    ? result.text.trim()
                    : 'Proxy returned an empty response.';
                const parsed = parseAssistantTextAndAction(rawText);
                setMessages((prev) => [...prev, { id: createId(), role: 'assistant', text: parsed.text }]);
                setPendingActionProposal(parsed.actionProposal);
                setStatusMessage('Gemma proxy connected.');
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
            setStatusMessage(`Gemma proxy error: ${error.message}`);
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

    const handleClearChat = async () => {
        if (pendingRequestId) {
            const runtime = getExtensionRuntime();
            runtime?.sendMessage({
                type: CHAT_CANCEL_MESSAGE_TYPE,
                requestId: pendingRequestId,
            });
        }

        setInput('');
        setPendingRequestId(null);
        setPendingActionProposal(null);
        setMessages(DEFAULT_MESSAGES);
        setStatusMessage('Gemma proxy mode enabled.');
        await clearPersistedChatState();
    };

    const handleTextareaKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            e.currentTarget.form?.requestSubmit();
        }
    };

    const handleTerminateThinking = () => {
        if (!pendingRequestId) {
            return;
        }

        const activeRequestId = pendingRequestId;
        setPendingRequestId(null);
        setPendingActionProposal(null);
        setStatusMessage('Request cancelled.');
        setMessages((prev) => [
            ...prev,
            {
                id: createId(),
                role: 'assistant',
                text: 'Request cancelled.',
            },
        ]);

        const runtime = getExtensionRuntime();
        runtime?.sendMessage({
            type: CHAT_CANCEL_MESSAGE_TYPE,
            requestId: activeRequestId,
        });
        setIsMenuOpen(false);
    };

    const requestAiResponse = useCallback(
        async (
            prompt: string,
            options: { echoUser: boolean; source: 'user' | 'completion' | 'checkin' } = {
                echoUser: true,
                source: 'user',
            }
        ) => {
            const normalizedPrompt = prompt.trim();
            if (!normalizedPrompt || isSending) {
                return;
            }

            const requestId = createId();
            setPendingActionProposal(null);

            const syntheticUserMessage: ChatMessage = { id: createId(), role: 'user', text: normalizedPrompt };
            const visibleMessages = options.echoUser ? [...messages, syntheticUserMessage] : messages;
            const historySeed = [...messages, syntheticUserMessage];
            const history = historySeed
                .filter((message) => message.text.trim().length > 0)
                .slice(-10)
                .map((message) => ({ role: message.role, text: message.text }));
            const todoContext = buildTodoContext(todos, personality);
            const assistantConfig = {
                personality,
                enableActionProposals: true,
                requireConfirmation: true,
                source: options.source,
            };

            if (options.echoUser) {
                setMessages(visibleMessages);
                setInput('');
            }

            setPendingRequestId(requestId);
            setStatusMessage('Gemma proxy: generating response...');
            if (isHydrated) {
                persistChatState({
                    messages: visibleMessages,
                    statusMessage: 'Gemma proxy: generating response...',
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
                        assistantConfig,
                        chatState: {
                            messages: visibleMessages,
                            statusMessage: 'Gemma proxy: generating response...',
                            pendingRequestId: requestId,
                        },
                    },
                    (response) => {
                        const runtimeError = chrome.runtime?.lastError;
                        if (runtimeError?.message) {
                            const error = new Error(runtimeError.message);
                            setMessages((prev) => [
                                ...prev,
                                { id: createId(), role: 'assistant', text: formatErrorForChat(error, PROXY_URL) },
                            ]);
                            setStatusMessage(`Gemma proxy error: ${runtimeError.message}`);
                            setPendingRequestId((current) => (current === requestId ? null : current));
                            return;
                        }

                        if (response?.ok === false && response.error === 'Invalid chat request payload.') {
                            const error = new Error(response.error);
                            setMessages((prev) => [
                                ...prev,
                                { id: createId(), role: 'assistant', text: formatErrorForChat(error, PROXY_URL) },
                            ]);
                            setStatusMessage(`Gemma proxy error: ${response.error}`);
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
                    body: JSON.stringify({ messages: history, todoContext, assistantConfig }),
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
                const parsed = parseAssistantTextAndAction(output || 'Proxy returned an empty response.');
                setMessages((prev) => [...prev, { id: createId(), role: 'assistant', text: parsed.text }]);
                setPendingActionProposal(parsed.actionProposal);
                setStatusMessage('Gemma proxy connected.');
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                setMessages((prev) => [
                    ...prev,
                    { id: createId(), role: 'assistant', text: formatErrorForChat(error, PROXY_URL) },
                ]);
                setStatusMessage(`Gemma proxy error: ${message || 'Unknown proxy error'}`);
            } finally {
                setPendingRequestId((current) => (current === requestId ? null : current));
            }
        },
        [isSending, messages, todos, personality, isHydrated]
    );

    const resolveTodo = useCallback(
        (proposal: ActionProposal): Todo | null => {
            if (proposal.todoId) {
                const byId = todos.find((todo) => todo.id === proposal.todoId);
                if (byId) {
                    return byId;
                }
            }

            if (proposal.todoTitle) {
                const target = proposal.todoTitle.trim().toLowerCase();
                if (!target) {
                    return null;
                }
                return todos.find((todo) => todo.title.trim().toLowerCase() === target) || null;
            }

            return null;
        },
        [todos]
    );

    const applyActionProposal = useCallback(() => {
        if (!pendingActionProposal) {
            return;
        }

        let resultText = 'I could not apply that action.';
        const proposal = pendingActionProposal;

        if (proposal.type === 'add_todo' && proposal.title) {
            onAddTodo(proposal.title, proposal.deadline);
            resultText = `Added todo: "${proposal.title}".`;
        } else if (proposal.type === 'complete_todo') {
            const todo = resolveTodo(proposal);
            if (todo) {
                if (!todo.completed) {
                    onToggleTodo(todo.id);
                }
                resultText = `Marked "${todo.title}" as completed.`;
            } else {
                resultText = 'I could not find the target todo to complete.';
            }
        } else if (proposal.type === 'delay_todo' && proposal.deadline) {
            const todo = resolveTodo(proposal);
            if (todo) {
                const todayStr = toLocalDateOnly(new Date());
                const isMovingToToday = proposal.deadline <= todayStr;
                onUpdateTodo(todo.id, {
                    deadline: proposal.deadline,
                    addedToFocusAt: isMovingToToday ? Date.now() : undefined,
                    ...(isMovingToToday && { bumpSentAt: undefined }),
                });
                resultText = `Moved "${todo.title}" to ${proposal.deadline}.`;
            } else {
                resultText = 'I could not find the task to delay.';
            }
        }

        setPendingActionProposal(null);
        setMessages((prev) => [...prev, { id: createId(), role: 'assistant', text: resultText }]);
    }, [onAddTodo, onToggleTodo, onUpdateTodo, pendingActionProposal, resolveTodo]);

    const dismissActionProposal = useCallback(() => {
        setPendingActionProposal(null);
        setMessages((prev) => [
            ...prev,
            { id: createId(), role: 'assistant', text: 'Understood. I will not make that change.' },
        ]);
    }, []);

    useEffect(() => {
        if (!isHydrated || isSending) {
            return;
        }

        const now = Date.now();
        const previousSnapshot = completionSnapshotRef.current;
        const nextSnapshot = new Map<string, boolean>();
        const newlyCompleted: string[] = [];

        for (const todo of todos) {
            const prevCompleted = previousSnapshot.get(todo.id) ?? false;
            nextSnapshot.set(todo.id, todo.completed);
            if (todo.completed && !prevCompleted) {
                newlyCompleted.push(`Todo complete: "${todo.title}"`);
            }
        }

        completionSnapshotRef.current = nextSnapshot;
        if (previousSnapshot.size === 0) {
            return;
        }
        if (newlyCompleted.length === 0) {
            return;
        }

        if (now - lastCompletionReactionAtRef.current < COMPLETION_REACTION_COOLDOWN_MS) {
            return;
        }

        lastCompletionReactionAtRef.current = now;
        const completionSummary = newlyCompleted.slice(0, 5).join('\n');
        void requestAiResponse(
            `The user just completed the following items:\n${completionSummary}\nReply briefly in character acknowledging this completion.`,
            { echoUser: false, source: 'completion' }
        );
    }, [isHydrated, isSending, requestAiResponse, todos]);

    // Bump when a focus task has been in focus longer than focusBumpAfterHours
    useEffect(() => {
        if (!isHydrated || isSending || focusBumpAfterHours < 1) {
            return;
        }
        const now = Date.now();
        if (now - lastBumpCheckAtRef.current < BUMP_CHECK_COOLDOWN_MS) {
            return;
        }
        lastBumpCheckAtRef.current = now;
        const ms = focusBumpAfterHours * 3600000;
        const focusTodos = todos.filter((t) => {
            if (!t.deadline) return false;
            const d = new Date(t.deadline + 'T00:00:00');
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const diff = Math.ceil((d.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
            return diff <= 0;
        });
        const needsBump = focusTodos.find(
            (t) =>
                t.addedToFocusAt != null &&
                now - t.addedToFocusAt >= ms &&
                (t.bumpSentAt == null || now - t.bumpSentAt >= ms)
        );
        if (!needsBump) {
            return;
        }
        onUpdateTodo(needsBump.id, { bumpSentAt: now });
        const prompt = `The user has had the task "${needsBump.title}" in their Focus list for over ${focusBumpAfterHours} hour(s). Send a single short, friendly nudge to check in on that task (as the assistant). Do not ask them to type a reply unless it feels natural.`;
        void requestAiResponse(prompt, { echoUser: false, source: 'checkin' });
    }, [isHydrated, isSending, todos, focusBumpAfterHours, requestAiResponse, onUpdateTodo]);

    // When tab opens from a task timer check-in alarm, send a check-in for that task
    useEffect(() => {
        if (!isHydrated || isSending) {
            return;
        }
        const storage = getExtensionStorage();
        if (!storage) {
            return;
        }
        storage.get([TASK_CHECKIN_REQUEST_KEY], (items: Record<string, unknown>) => {
            const data = items?.[TASK_CHECKIN_REQUEST_KEY];
            if (!data || typeof data !== 'object' || !(data as { taskId?: string }).taskId) {
                return;
            }
            const payload = data as { taskId: string; taskTitle?: string };
            storage.set({ [TASK_CHECKIN_REQUEST_KEY]: null });
            const taskTitle = payload.taskTitle || 'your task';
            const prompt = `You are doing a scheduled check-in for the task "${taskTitle}". Send a single short, friendly message (as the assistant) to check in on this task.`;
            void requestAiResponse(prompt, { echoUser: false, source: 'checkin' });
        });
    }, [isHydrated, isSending, requestAiResponse]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const prompt = input.trim();
        if (!prompt || isSending) {
            return;
        }
        setIsMenuOpen(false);
        await requestAiResponse(prompt, { echoUser: true, source: 'user' });
    };

    const hasMessages = messages.length > 1;
    return (
        <div className={`companion-frame ${hasMessages ? 'companion-frame--has-messages' : ''}`}>
            <div className="companion-chat">
                <div className="companion-chat-header">
                    <div className="companion-chat-header-row">
                        <div />
                        <div className="chat-menu-wrap" ref={menuRef}>
                            <button
                                type="button"
                                className="chat-menu-toggle"
                                onClick={() => {
                                    setIsMenuOpen((prev) => !prev);
                                }}
                                aria-label="Chat menu"
                                aria-expanded={isMenuOpen}
                            >
                                ...
                            </button>
                            {isMenuOpen && (
                                <div className="chat-menu">
                                    <button
                                        type="button"
                                        className="chat-menu-item"
                                        onClick={handleTerminateThinking}
                                        disabled={!isSending}
                                    >
                                        Terminate
                                    </button>
                                    <button
                                        type="button"
                                        className="chat-menu-item"
                                        onClick={() => {
                                            setIsMenuOpen(false);
                                            void handleClearChat();
                                        }}
                                    >
                                        Clear
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
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
                    {pendingActionProposal && (
                        <div className="action-confirm-card">
                            <p>{getActionConfirmDescription(pendingActionProposal, resolveTodo)}</p>
                            <div className="action-confirm-buttons">
                                <button type="button" onClick={applyActionProposal}>
                                    Confirm
                                </button>
                                <button type="button" className="secondary" onClick={dismissActionProposal}>
                                    Cancel
                                </button>
                            </div>
                        </div>
                    )}
                    {isSending && (
                        <div
                            className="chat-bubble assistant chat-thinking"
                            title="Your message was sent to the proxy server. The server is running the Gemma model to generate a reply. This usually takes a few seconds."
                        >
                            <strong>Thinking…</strong>
                            <p className="chat-thinking-detail">Request is with the server; Gemma is generating your reply.</p>
                        </div>
                    )}
                    <div ref={messagesEndRef} />
                </div>

                <form className="companion-chat-input" onSubmit={handleSubmit}>
                    <textarea
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={handleTextareaKeyDown}
                        placeholder={isSending ? 'Waiting for reply…' : 'Ask Todo AI...'}
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
