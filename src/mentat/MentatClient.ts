// Day 9. Talks to the local Hono proxy at POST /api/mentat; the LLM key lives in
// server/.env and never reaches the browser (CLAUDE.md).
//
// The proxy answers with Server-Sent Events. EventSource cannot POST, so this
// reads the response body as a stream with fetch and splits it into SSE
// messages itself, calling back as each one arrives:
//   token    a few characters of the answer (render them immediately)
//   tool     the agent is using a tool (show "consulting the archives")
//   action   a validated teleport for the game to carry out
//   done     finished
//   fallback the proxy has no model or the model failed: answer offline
// A network failure is reported as a fallback too, so the panel has one path.

export interface MentatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface MentatRequest {
  question: string;
  /** Built by contextBuilder.ts: scene state and the lore entry. */
  context: string;
  /** Last few turns, for continuity. */
  history: MentatTurn[];
}

export interface TeleportAction {
  type: 'teleport';
  bodyId: string;
  bodyName: string;
  poiId: string | null;
  poiName: string | null;
}

export type MentatEvent =
  | { type: 'token'; text: string }
  | { type: 'tool'; name: string }
  | { type: 'action'; action: TeleportAction }
  | { type: 'done'; model: string }
  | { type: 'fallback'; reason: string };

export class MentatClient {
  constructor(private readonly endpoint = '/api/mentat') {}

  /** Stream one answer. Resolves when the stream ends; never throws. */
  async ask(request: MentatRequest, onEvent: (event: MentatEvent) => void, signal?: AbortSignal): Promise<void> {
    let response: Response;
    try {
      response = await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
        ...(signal ? { signal } : {}),
      });
    } catch {
      onEvent({ type: 'fallback', reason: 'The proxy is unreachable.' });
      return;
    }
    if (!response.ok || !response.body) {
      onEvent({ type: 'fallback', reason: `The proxy answered ${response.status}.` });
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let finished = false;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        // SSE messages are separated by a blank line.
        let boundary: number;
        while ((boundary = buffer.search(/\r?\n\r?\n/)) >= 0) {
          const message = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary).replace(/^\r?\n\r?\n/, '');
          const data = message
            .split(/\r?\n/)
            .filter((line) => line.startsWith('data:'))
            .map((line) => line.slice(5).trimStart())
            .join('\n');
          if (!data) continue;
          try {
            const event = JSON.parse(data) as MentatEvent;
            if (event.type === 'done' || event.type === 'fallback') finished = true;
            onEvent(event);
          } catch {
            /* ignore a malformed message */
          }
        }
      }
    } catch {
      if (!finished) onEvent({ type: 'fallback', reason: 'The link dropped mid-answer.' });
      return;
    }
    if (!finished) onEvent({ type: 'fallback', reason: 'The answer ended early.' });
  }
}
