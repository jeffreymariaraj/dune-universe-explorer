// The Mentat proxy as a portable Hono app (SYSTEM_DESIGN.md section 9).
//
// Why it exists: the LLM API key must never reach the browser. The frontend
// only ever POSTs to /api/mentat; this app is the only thing that holds the key.
// It uses web-standard Request/Response only, so the same app runs in two
// places:
//   * locally:  server/index.ts serves it with @hono/node-server on :8787,
//               and Vite proxies /api to it (npm run dev + npm run server)
//   * Vercel:   api/index.ts exports it as an Edge Function (same /api path)
//
// POST /api/mentat streams Server-Sent Events from the agent loop
// (mentatAgent.ts). Whenever no answer can come from the model — no key,
// upstream failure, or a RATE LIMIT — it streams one 'fallback' event and the
// browser answers from planets.json itself, so the game never breaks.
//
// Configuration (environment). Groq is the default, so a key alone is enough:
//   GROQ_API_KEY=...            (or LLM_API_KEY)
//   LLM_BASE_URL=...            optional, default https://api.groq.com/openai/v1
//   LLM_MODEL=...               optional, default openai/gpt-oss-120b

import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import { streamSSE } from 'hono/streaming';
import { runAgent, type AgentEvent, type ChatTurn, type LlmConfig } from './mentatAgent';
import { RateLimiter } from './rateLimiter';

const GROQ_BASE_URL = 'https://api.groq.com/openai/v1';
/** Chosen on Day 9: supports streamed tool calls on Groq; first token in ~0.6 s in testing. */
const DEFAULT_MODEL = 'openai/gpt-oss-120b';

// ---- strict input caps (public deploy) -------------------------------------
/** Largest request body accepted, bytes. A real request is ~2-4 KB. */
const MAX_BODY_BYTES = 16 * 1024;
const MAX_QUESTION = 300;
const MAX_CONTEXT = 4000;
const MAX_TURNS = 4;
const MAX_TURN_CHARS = 600;

export interface MentatAppOptions {
  env?: Record<string, string | undefined>;
  limiter?: RateLimiter;
}

export function createMentatApp(options: MentatAppOptions = {}): Hono {
  const env = options.env ?? process.env;
  const config: LlmConfig = {
    baseUrl: env['LLM_BASE_URL'] || GROQ_BASE_URL,
    apiKey: env['LLM_API_KEY'] || env['GROQ_API_KEY'] || '',
    model: env['LLM_MODEL'] || DEFAULT_MODEL,
  };
  const llmConfigured = Boolean(config.apiKey);
  const limiter = options.limiter ?? new RateLimiter();

  const app = new Hono();

  // Same-origin on Vercel and through Vite's proxy; CORS only matters for `vite preview`.
  app.use(
    '/api/*',
    cors({ origin: ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:4173'] }),
  );

  app.get('/api/health', (c) => c.json({ ok: true, llmConfigured, model: llmConfigured ? config.model : null }));

  app.post(
    '/api/mentat',
    bodyLimit({ maxSize: MAX_BODY_BYTES, onError: (c) => c.json({ error: 'Request too large' }, 413) }),
    async (c) => {
      let body: Record<string, unknown> = {};
      try {
        body = await c.req.json<Record<string, unknown>>();
      } catch {
        return c.json({ error: 'Expected a JSON body' }, 400);
      }
      const question = typeof body['question'] === 'string' ? body['question'].trim().slice(0, MAX_QUESTION) : '';
      if (!question) return c.json({ error: 'Field "question" is required' }, 400);
      const context = typeof body['context'] === 'string' ? body['context'].slice(0, MAX_CONTEXT) : '';
      const history = sanitiseHistory(body['history']);

      if (!llmConfigured) return fallback(c, 'No model configured on the proxy.');

      // Strict rate limit, checked only when the model would actually be called.
      const decision = limiter.take(callerKey(c));
      if (!decision.allowed) {
        c.header('Retry-After', String(decision.retryAfterSeconds));
        const minutes = Math.max(1, Math.ceil(decision.retryAfterSeconds / 60));
        const who = decision.reason === 'global' ? 'The Mentat is answering many pilots' : 'The Mentat needs to rest';
        return fallback(c, `${who}; the live link returns in about ${minutes} min.`);
      }

      return streamSSE(c, async (stream) => {
        const emit = async (event: AgentEvent): Promise<void> => {
          await stream.writeSSE({ data: JSON.stringify(event) });
        };
        const abort = new AbortController();
        stream.onAbort(() => abort.abort());
        try {
          await runAgent(config, { question, context, history }, emit, abort.signal);
        } catch (error) {
          console.warn('Mentat: upstream failed:', error instanceof Error ? error.message : error);
          await emit({ type: 'fallback', reason: 'The link to the archives failed.' });
        }
      });
    },
  );

  app.notFound((c) => c.json({ error: 'Not found' }, 404));
  return app;
}

/** One SSE message telling the browser to answer offline from planets.json. */
function fallback(c: Context, reason: string): Response {
  return streamSSE(c, async (stream) => {
    await stream.writeSSE({ data: JSON.stringify({ type: 'fallback', reason } satisfies AgentEvent) });
  });
}

/** The caller's IP: Vercel sets x-real-ip / x-forwarded-for; locally there is none. */
function callerKey(c: Context): string {
  const forwarded = c.req.header('x-forwarded-for')?.split(',')[0]?.trim();
  return c.req.header('x-real-ip') || forwarded || 'local';
}

function sanitiseHistory(value: unknown): ChatTurn[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (t): t is ChatTurn =>
        typeof t === 'object' &&
        t !== null &&
        ((t as ChatTurn).role === 'user' || (t as ChatTurn).role === 'assistant') &&
        typeof (t as ChatTurn).content === 'string',
    )
    .slice(-MAX_TURNS)
    .map((t) => ({ role: t.role, content: t.content.slice(0, MAX_TURN_CHARS) }));
}
