// Local Mentat proxy: serves the shared Hono app (server/app.ts) on :8787.
// `npm run server` runs this; Vite's dev server proxies /api here
// (vite.config.ts). On Vercel the same app runs from api/index.ts instead.

import { serve } from '@hono/node-server';
import { createMentatApp } from './app';

const PORT = Number(process.env['PORT'] ?? 8787);
const app = createMentatApp();
const configured = Boolean(process.env['LLM_API_KEY'] || process.env['GROQ_API_KEY']);

serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`Mentat proxy listening on http://localhost:${info.port}`);
  console.log(
    configured
      ? 'LLM key found; the Mentat is live (rate-limited, see server/rateLimiter.ts).'
      : 'LLM not configured (put GROQ_API_KEY in server/.env); the browser will answer from planets.json.',
  );
});
