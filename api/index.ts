// Vercel entry for the Mentat proxy: the shared Hono app (server/app.ts) as an
// Edge Function. vercel.json rewrites every /api/* path here; Hono routes on the
// original path (/api/health, /api/mentat), exactly as in local dev.
//
// Edge runtime: web-standard Request/Response, streaming responses (the SSE
// answer arrives word by word), and Vercel bundles the imports (including
// planets.json) into one file. Set GROQ_API_KEY in the Vercel project's
// Environment Variables; it never reaches the browser.

import { createMentatApp } from '../server/app';

export const config = { runtime: 'edge' };

const app = createMentatApp();

export default function handler(request: Request): Response | Promise<Response> {
  return app.fetch(request);
}
