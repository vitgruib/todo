import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envFile = join(__dirname, '.env');

if (existsSync(envFile)) {
    const lines = readFileSync(envFile, 'utf8').split(/\r?\n/);
    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) {
            continue;
        }

        const splitIndex = line.indexOf('=');
        if (splitIndex <= 0) {
            continue;
        }

        const key = line.slice(0, splitIndex).trim();
        const value = line.slice(splitIndex + 1).trim().replace(/^['"]|['"]$/g, '');

        if (!(key in process.env)) {
            process.env[key] = value;
        }
    }
}

const PORT = Number(process.env.PORT ?? '8787');
const GEMINI_API_KEY = (process.env.GEMINI_API_KEY ?? '').trim();
const DEFAULT_GEMMA_MODEL = 'gemma-3-27b-it';
/** Google removed these from v1beta generateContent; map so old env vars keep working. */
const LEGACY_GEMMA_MODEL_ALIASES = new Map([['gemma-2-9b-it', DEFAULT_GEMMA_MODEL]]);
let GEMINI_MODEL = (process.env.GEMINI_MODEL ?? DEFAULT_GEMMA_MODEL).trim();
if (GEMINI_MODEL.toLowerCase().startsWith('gemini-')) {
    GEMINI_MODEL = DEFAULT_GEMMA_MODEL;
} else {
    const replacement = LEGACY_GEMMA_MODEL_ALIASES.get(GEMINI_MODEL.toLowerCase());
    if (replacement) {
        console.warn(`GEMINI_MODEL "${GEMINI_MODEL}" is no longer available; using ${replacement}.`);
        GEMINI_MODEL = replacement;
    }
}
const SYSTEM_PROMPT =
    'You are Todo AI, powered by Gemma. Do not claim to be Gemini or any other model. Talk like a real person: use contractions, short sentences, and a warm but efficient tone. Keep responses concise and actionable. Help break tasks into practical steps when asked.';

if (!GEMINI_API_KEY) {
    console.error('Missing GEMINI_API_KEY.');
    process.exit(1);
}

const sendJson = (res, statusCode, payload) => {
    res.writeHead(statusCode, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    });
    res.end(JSON.stringify(payload));
};

const readBody = async (req) => {
    let body = '';

    for await (const chunk of req) {
        body += chunk;
        if (body.length > 1_000_000) {
            throw new Error('Request body too large');
        }
    }

    if (!body) {
        return {};
    }

    return JSON.parse(body);
};

const extractGeminiText = (payload) => {
    const parts = payload?.candidates?.[0]?.content?.parts;
    if (!Array.isArray(parts)) {
        return '';
    }

    return parts
        .map((part) => (typeof part?.text === 'string' ? part.text : ''))
        .filter(Boolean)
        .join('\n')
        .trim();
};

const toGeminiRole = (role) => (role === 'assistant' ? 'model' : 'user');

const normalizeTodoContext = (value) => {
    if (value === null || value === undefined) {
        return '';
    }

    if (typeof value === 'string') {
        return value.trim().slice(0, 20_000);
    }

    if (typeof value === 'object') {
        try {
            return JSON.stringify(value).slice(0, 20_000);
        } catch {
            return '';
        }
    }

    return '';
};

const normalizeAssistantConfig = (value) => {
    if (!value || typeof value !== 'object') {
        return {
            personality: 'normal',
            enableActionProposals: true,
            requireConfirmation: true,
            source: 'user',
        };
    }

    const candidate = value;
    const personality = candidate.personality === 'endearing' || candidate.personality === 'caustic'
        ? candidate.personality
        : 'normal';

    return {
        personality,
        enableActionProposals: Boolean(candidate.enableActionProposals),
        requireConfirmation: Boolean(candidate.requireConfirmation),
        source: typeof candidate.source === 'string' ? candidate.source : 'user',
    };
};

const personalityInstructions = (personality) => {
    if (personality === 'endearing') {
        return 'Be extremely warm, affectionate, and supportive. Celebrate wins enthusiastically.';
    }
    if (personality === 'caustic') {
        return 'Use sharp, caustic humor and harsh roasts while still giving useful, actionable guidance.';
    }
    return 'Be friendly and practical. Sound like a helpful human—use natural language, a bit of warmth, and avoid stiff or corporate phrasing.';
};

const actionProposalInstructions = `If the user asks you to edit their todo list, DO NOT claim the change is already done.
Your "message" must describe only what will happen when the user clicks Apply (e.g. "I'll mark that complete" for complete_todo, "I'll move it to tomorrow" for delay_todo). Never say you have already moved, added, or completed something—the change happens only after they confirm.
Return a JSON block in this exact shape inside a \`\`\`json fence:
{
  "message": "what will happen when they click Apply (must match the action type)",
  "actionProposal": {
    "type": "add_todo" | "complete_todo" | "delay_todo",
    "reason": "why this action helps",
    "todoId": "optional id",
    "todoTitle": "optional exact title (match list exactly)",
    "title": "for add_todo",
    "deadline": "YYYY-MM-DD (required for add_todo optional date, required for delay_todo)"
  }
}
Use "delay_todo" when the user wants to postpone or reschedule a task: set "type" to "delay_todo", include "todoId" or "todoTitle" to identify the task, and "deadline" to the new date (YYYY-MM-DD).
If no list edit is requested, do not include actionProposal JSON.`;

const buildSystemPrompt = (todoContext, assistantConfig) => {
    const toneInstruction = personalityInstructions(assistantConfig.personality);
    const sourceHint =
        assistantConfig.source === 'completion'
            ? 'The latest prompt is an event update about completed work. Respond briefly with acknowledgement.'
            : assistantConfig.source === 'checkin'
              ? 'The latest prompt asks you to do a check-in. Ask how the user is doing in one short line.'
              : '';

    const instructions = [
        SYSTEM_PROMPT,
        toneInstruction,
        sourceHint,
        assistantConfig.enableActionProposals ? actionProposalInstructions : '',
        assistantConfig.requireConfirmation
            ? 'Never execute list changes yourself. Always wait for explicit user confirmation first.'
            : '',
    ]
        .filter(Boolean)
        .join('\n\n');

    if (!todoContext) {
        return instructions;
    }

    return `${instructions}\n\nCurrent user todo context (JSON):\n${todoContext}`;
};

const server = createServer(async (req, res) => {
    if (req.method === 'OPTIONS') {
        sendJson(res, 204, {});
        return;
    }

    if (req.method === 'GET' && req.url === '/') {
        sendJson(res, 200, {
            ok: true,
            service: 'gemini-proxy',
            usage: 'POST /api/chat',
        });
        return;
    }

    if (req.method === 'GET' && req.url === '/health') {
        sendJson(res, 200, {
            ok: true,
            service: 'gemini-proxy',
        });
        return;
    }

    if (req.method === 'GET' && req.url === '/api/chat') {
        sendJson(res, 200, {
            ok: true,
            message: 'Use POST /api/chat with JSON body: { "messages": [{ "role": "user", "text": "hello" }] }',
        });
        return;
    }

    if (req.method !== 'POST' || req.url !== '/api/chat') {
        sendJson(res, 404, { error: 'Not found' });
        return;
    }

    try {
        const body = await readBody(req);
        const todoContext = normalizeTodoContext(body?.todoContext);
        const assistantConfig = normalizeAssistantConfig(body?.assistantConfig);
        const inputMessages = Array.isArray(body?.messages) ? body.messages : [];
        const messages = inputMessages
            .filter((message) => typeof message?.text === 'string' && message.text.trim().length > 0)
            .slice(-10)
            .map((message) => ({
                role: toGeminiRole(message.role),
                parts: [{ text: String(message.text) }],
            }));

        if (messages.length === 0) {
            sendJson(res, 400, { error: 'No messages provided' });
            return;
        }

        const endpoint =
            `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}` +
            `:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;

        const geminiResponse = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                system_instruction: {
                    parts: [{ text: buildSystemPrompt(todoContext, assistantConfig) }],
                },
                contents: messages,
            }),
        });

        const payload = await geminiResponse.json().catch(() => null);
        if (!geminiResponse.ok) {
            const errorMessage = payload?.error?.message || `Gemma API failed (${geminiResponse.status})`;
            sendJson(res, 502, { error: errorMessage });
            return;
        }

        const text = extractGeminiText(payload);
        sendJson(res, 200, { text: text || 'Gemma returned an empty response.' });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unexpected proxy error';
        sendJson(res, 500, { error: message });
    }
});

server.listen(PORT, () => {
    console.log(`Gemma proxy listening on http://localhost:${PORT} (model: ${GEMINI_MODEL})`);
});
