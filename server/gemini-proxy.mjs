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
const LEGACY_GEMMA_MODEL_ALIASES = new Map([
    ['gemma-2-9b-it', DEFAULT_GEMMA_MODEL],
    ['gemma-2-9b', DEFAULT_GEMMA_MODEL],
]);

const parseModelFromEnv = (raw) => {
    if (raw == null || String(raw).trim() === '') {
        return DEFAULT_GEMMA_MODEL;
    }
    let id = String(raw).trim().replace(/^['"]|['"]$/g, '');
    const lower = id.toLowerCase();
    if (lower.startsWith('models/')) {
        id = id.slice('models/'.length).trim();
    }
    return id || DEFAULT_GEMMA_MODEL;
};

let GEMINI_MODEL = parseModelFromEnv(process.env.GEMINI_MODEL);
const modelKey = GEMINI_MODEL.toLowerCase();
if (modelKey.startsWith('gemini-')) {
    GEMINI_MODEL = DEFAULT_GEMMA_MODEL;
} else {
    const replacement = LEGACY_GEMMA_MODEL_ALIASES.get(modelKey);
    if (replacement) {
        console.warn(`GEMINI_MODEL "${process.env.GEMINI_MODEL ?? ''}" is no longer available; using ${replacement}.`);
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
            personality: 'endearing',
            enableActionProposals: true,
            requireConfirmation: true,
            source: 'user',
        };
    }

    const candidate = value;
    const personality = candidate.personality === 'endearing' || candidate.personality === 'caustic'
        ? candidate.personality
        : 'endearing';

    return {
        personality,
        enableActionProposals: Boolean(candidate.enableActionProposals),
        requireConfirmation: Boolean(candidate.requireConfirmation),
        source: typeof candidate.source === 'string' ? candidate.source : 'user',
    };
};

const personalityInstructions = (personality) => {
    if (personality === 'endearing') {
        return (
            'Tone: wildly, almost cartoonishly endearing. You are their biggest fan. Pile on sincere hype, tender encouragement, and delighted reactions to every tiny step—like a best friend who thinks they hung the moon. ' +
            'Go over the top with warmth (still readable; avoid repeating the same phrase every line). Never sound neutral or corporate.'
        );
    }
    return (
        'Tone: caustic, heavily sarcastic, and theatrically unimpressed—like a roast comic who secretly wants them to win. ' +
        'Deliver creative, surprising burns and dry one-liners about the situation (and lightly about the user when it lands a joke), but always steer back to concrete, useful next steps. ' +
        'Never be cruel about real pain or crises; the bite is playful, not mean-spirited.'
    );
};

const actionProposalInstructions = `Todo list edits (add, complete, reschedule) are NEVER automatic.

When the user wants their list changed—or you think a list change would help—you must run a confirmation flow in chat:
1) First ask what they want changed in plain language (which task by exact title if possible, add vs complete vs move, and dates in YYYY-MM-DD if relevant). If anything is ambiguous, ask follow-up questions. Do NOT output an actionProposal JSON block in this step.
2) After they answer, restate the exact plan in one short paragraph and ask them to confirm explicitly (e.g. they should reply with clear agreement like "yes, do that" or "confirm" for that plan). Still no JSON until they confirm.
3) Only after they have explicitly confirmed that specific plan in a later message, output a single \`\`\`json\`\`\` block with the structured proposal so they can use the in-app Confirm button.

Until step 3, your reply must be conversational questions or the restatement+confirmation ask only—no \`\`\`json\`\`\` fence with actionProposal.

When you finally output JSON (step 3 only), DO NOT claim the change is already done. The "message" field must describe what will happen when they click Confirm in the UI (e.g. mark which task complete, add which title, move which task to which date). Never say you already moved, added, or completed anything.

Shape inside the fence:
{
  "message": "what will happen when they click Confirm (must match the action type)",
  "actionProposal": {
    "type": "add_todo" | "complete_todo" | "delay_todo",
    "reason": "why this action helps",
    "todoId": "optional id",
    "todoTitle": "optional exact title (match list exactly)",
    "title": "for add_todo",
    "deadline": "YYYY-MM-DD (optional for add_todo, required for delay_todo)"
  }
}
Use "delay_todo" for postpone/reschedule: include "todoId" or "todoTitle" and "deadline" as the new date (YYYY-MM-DD).

If no list edit is in scope, do not include actionProposal JSON.`;

const buildSystemPrompt = (todoContext, assistantConfig) => {
    const toneInstruction = personalityInstructions(assistantConfig.personality);
    const sourceHint =
        assistantConfig.source === 'completion'
            ? 'The latest prompt is an event update about completed work. Respond briefly with acknowledgement, still fully in your configured tone (endearing or caustic).'
            : assistantConfig.source === 'checkin'
              ? 'The latest prompt asks you to do a check-in. One short line, in your configured tone (endearing or caustic).'
              : '';

    const instructions = [
        SYSTEM_PROMPT,
        toneInstruction,
        sourceHint,
        assistantConfig.enableActionProposals ? actionProposalInstructions : '',
        assistantConfig.requireConfirmation
            ? 'Never execute or imply completed list changes without the user’s explicit confirmation flow above and the in-app Confirm action.'
            : '',
    ]
        .filter(Boolean)
        .join('\n\n');

    if (!todoContext) {
        return instructions;
    }

    return `${instructions}\n\nCurrent user todo context (JSON):\n${todoContext}`;
};

/** Hosted Gemma on the Generative Language API rejects `system_instruction` ("Developer instruction is not enabled"). */
const geminiModelSupportsSystemInstruction = () => !GEMINI_MODEL.toLowerCase().startsWith('gemma-');

const mergeSystemPromptIntoContents = (contents, systemText) => {
    const out = contents.map((entry) => ({
        role: entry.role,
        parts: entry.parts.map((part) => ({ ...part })),
    }));
    const userIndex = out.findIndex((entry) => entry.role === 'user');
    if (userIndex >= 0) {
        const first = out[userIndex].parts[0];
        const existing = typeof first?.text === 'string' ? first.text : '';
        out[userIndex].parts[0] = { text: `${systemText}\n\n---\n\n${existing}` };
        return out;
    }

    return [{ role: 'user', parts: [{ text: systemText }] }, ...out];
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

        const systemText = buildSystemPrompt(todoContext, assistantConfig);
        const payloadBody = geminiModelSupportsSystemInstruction()
            ? {
                  system_instruction: { parts: [{ text: systemText }] },
                  contents: messages,
              }
            : { contents: mergeSystemPromptIntoContents(messages, systemText) };

        const geminiResponse = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payloadBody),
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
