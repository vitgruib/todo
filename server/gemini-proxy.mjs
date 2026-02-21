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
const GEMINI_MODEL = (process.env.GEMINI_MODEL ?? 'gemini-2.5-flash-lite').trim();
const SYSTEM_PROMPT =
    'You are Todo AI. Keep responses concise and actionable. Help break tasks into practical steps when asked.';

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

const buildSystemPrompt = (todoContext) => {
    if (!todoContext) {
        return SYSTEM_PROMPT;
    }

    return `${SYSTEM_PROMPT}\n\nCurrent user todo context (JSON):\n${todoContext}`;
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
                    parts: [{ text: buildSystemPrompt(todoContext) }],
                },
                contents: messages,
            }),
        });

        const payload = await geminiResponse.json().catch(() => null);
        if (!geminiResponse.ok) {
            const errorMessage = payload?.error?.message || `Gemini API failed (${geminiResponse.status})`;
            sendJson(res, 502, { error: errorMessage });
            return;
        }

        const text = extractGeminiText(payload);
        sendJson(res, 200, { text: text || 'Gemini returned an empty response.' });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unexpected proxy error';
        sendJson(res, 500, { error: message });
    }
});

server.listen(PORT, () => {
    console.log(`Gemini proxy listening on http://localhost:${PORT}`);
});
