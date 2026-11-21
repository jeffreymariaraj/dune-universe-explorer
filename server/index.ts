// The Mentat proxy (SYSTEM_DESIGN.md section 9).
//
// Why it exists: the LLM API key must never reach the browser. The frontend only
// ever POSTs to /api/mentat, Vite proxies that to this process on port 8787, and
// this process is the only thing that holds the key (server/.env, gitignored).
//
// Day 9: POST /api/mentat streams Server-Sent Events from the agent loop in
// mentatAgent.ts (text tokens, tool use, teleport actions). If no model is
// configured or the upstream call fails, it streams a single 'fallback' event
// and the browser answers from planets.json on its own, so the demo never breaks.
//
// Configuration (server/.env). Groq is the default, so a key alone is enough:
//   GROQ_API_KEY=...            (or LLM_API_KEY)
//   LLM_BASE_URL=...            optional, default https://api.groq.com/openai/v1
//   LLM_MODEL=...               optional, default openai/gpt-oss-120b

import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { streamSSE } from 'hono/streaming';
import { runAgent, type AgentEvent, type ChatTurn, type LlmConfig } from './mentatAgent';

interface MentatRequestBody {
  question?: unknown;
  context?: unknown;
  history?: unknown;
}

const GROQ_BASE_URL = 'https://api.groq.com/openai/v1';
/** Chosen on Day 9: supports streamed tool calls on Groq; first token in ~0.6 s in testing. */
const DEFAULT_MODEL = 'openai/gpt-oss-120b';

const PORT = Number(process.env['PORT'] ?? 8787);
const config: LlmConfig = {
  baseUrl: process.env['LLM_BASE_URL'] || GROQ_BASE_URL,
  apiKey: process.env['LLM_API_KEY'] || process.env['GROQ_API_KEY'] || '',
  model: process.env['LLM_MODEL'] || DEFAULT_MODEL,
};
const llmConfigured = Boolean(config.apiKey);

/** Keep requests small and well-formed whatever the client sends. */
const MAX_QUESTION = 600;
const MAX_CONTEXT = 6000;
const MAX_TURNS = 4;

const app = new Hono();

// Vite proxies /api in dev, so same-origin; CORS is here for `vite preview`.
app.use('/api/*', cors({ origin: ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:4173'] }));

app.get('/api/health', (c) =>
  c.json({ ok: true, llmConfigured, model: llmConfigured ? config.model : null }),
);

app.post('/api/mentat', async (c) => {
  let body: MentatRequestBody = {};
  try {
    body = await c.req.json<MentatRequestBody>();
  } catch {
    return c.json({ error: 'Expected a JSON body' }, 400);
  }
  const question = typeof body.question === 'string' ? body.question.trim().slice(0, MAX_QUESTION) : '';
  if (!question) return c.json({ error: 'Field "question" is required' }, 400);
  const context = typeof body.context === 'string' ? body.context.slice(0, MAX_CONTEXT) : '';
  const history: ChatTurn[] = Array.isArray(body.history)
    ? body.history
        .filter(
          (t): t is ChatTurn =>
            typeof t === 'object' && t !== null &&
            ((t as ChatTurn).role === 'user' || (t as ChatTurn).role === 'assistant') &&
            typeof (t as ChatTurn).content === 'string',
        )
        .slice(-MAX_TURNS)
        .map((t) => ({ role: t.role, content: t.content.slice(0, 1500) }))
    : [];

  return streamSSE(c, async (stream) => {
    const emit = async (event: AgentEvent): Promise<void> => {
      await stream.writeSSE({ data: JSON.stringify(event) });
    };
    if (!llmConfigured) {
      await emit({ type: 'fallback', reason: 'No model configured on the proxy.' });
      return;
    }
    const abort = new AbortController();
    stream.onAbort(() => abort.abort());
    try {
      await runAgent(config, { question, context, history }, emit, abort.signal);
    } catch (error) {
      console.warn('Mentat: upstream failed:', error instanceof Error ? error.message : error);
      await emit({ type: 'fallback', reason: 'The link to the archives failed.' });
    }
  });
});

app.notFound((c) => c.json({ error: 'Not found' }, 404));

serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`Mentat proxy listening on http://localhost:${info.port}`);
  console.log(
    llmConfigured
      ? `LLM configured: ${config.model} via ${config.baseUrl}`
      : 'LLM not configured (put GROQ_API_KEY in server/.env); the browser will answer from planets.json.',
  );
});
