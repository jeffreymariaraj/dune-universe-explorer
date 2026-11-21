import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMentatApp } from './app';
import { RateLimiter } from './rateLimiter';

/** A fake upstream that streams one short answer in OpenAI SSE format. */
function fakeLlm(): Response {
  const body = [
    `data: ${JSON.stringify({ choices: [{ delta: { content: 'The archives ' } }] })}\n\n`,
    `data: ${JSON.stringify({ choices: [{ delta: { content: 'are open.' } }] })}\n\n`,
    'data: [DONE]\n\n',
  ].join('');
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

const ask = (app: ReturnType<typeof createMentatApp>, question = 'Tell me about Arrakis', ip = '9.9.9.9') =>
  app.request('/api/mentat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-real-ip': ip },
    body: JSON.stringify({ question, context: 'SCENE: test' }),
  });

afterEach(() => vi.unstubAllGlobals());

describe('Mentat proxy app', () => {
  it('falls back to the offline archive when no key is configured', async () => {
    const app = createMentatApp({ env: {} });
    const text = await (await ask(app)).text();
    expect(text).toContain('"type":"fallback"');
  });

  it('streams the model answer, then rate-limits the same caller with a graceful fallback', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => fakeLlm()));
    const limiter = new RateLimiter({ perKey: [{ limit: 1, ms: 60_000 }], global: [{ limit: 100, ms: 3_600_000 }] });
    const app = createMentatApp({ env: { GROQ_API_KEY: 'test-key' }, limiter });

    const first = await (await ask(app)).text();
    expect(first).toContain('The archives ');
    expect(first).toContain('"type":"done"');

    const second = await ask(app);
    expect(second.status).toBe(200); // still a stream: the browser switches to offline answers
    expect(second.headers.get('Retry-After')).toBeTruthy();
    expect(await second.text()).toMatch(/"type":"fallback".*rest/);

    // A different visitor is unaffected.
    expect(await (await ask(app, 'Hello', '8.8.8.8')).text()).toContain('"type":"done"');
  });

  it('never calls the model for rate-limited or oversized requests', async () => {
    const upstream = vi.fn(async () => fakeLlm());
    vi.stubGlobal('fetch', upstream);
    const limiter = new RateLimiter({ perKey: [{ limit: 0, ms: 60_000 }], global: [] });
    const app = createMentatApp({ env: { GROQ_API_KEY: 'test-key' }, limiter });
    await (await ask(app)).text();

    const huge = await app.request('/api/mentat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': String(64 * 1024) },
      body: JSON.stringify({ question: 'x'.repeat(64 * 1024) }),
    });
    expect(huge.status).toBe(413);
    expect(upstream).not.toHaveBeenCalled();
  });

  it('caps the question length it forwards', async () => {
    const upstream = vi.fn(async (_url: string, init: RequestInit) => {
      const sent = JSON.parse(String(init.body)) as { messages: Array<{ role: string; content: string }> };
      const user = sent.messages.filter((m) => m.role === 'user').pop()!;
      expect(user.content.length).toBeLessThanOrEqual(300);
      return fakeLlm();
    });
    vi.stubGlobal('fetch', upstream);
    const app = createMentatApp({ env: { GROQ_API_KEY: 'k' } });
    await (await ask(app, 'why '.repeat(200))).text();
    expect(upstream).toHaveBeenCalledTimes(1);
  });
});
