// Day 9. The Mentat's agent loop: a streamed chat completion with tools, run
// against any OpenAI-compatible API (Groq by default).
//
//   round 1..MAX_ROUNDS:
//     stream /chat/completions with the tool list
//       content deltas  -> forwarded to the browser at once ("token" events)
//       tool-call deltas -> accumulated (name and JSON arguments arrive in pieces)
//     no tool calls?   -> done
//     else run each tool (mentatTools.ts), append the results, go round again
//
// A valid teleport also emits an "action" event for the game. At most one
// teleport per question, so a confused model cannot bounce the pilot around.

import { runTool, TOOL_DEFINITIONS, type TeleportAction } from './mentatTools';

export const SYSTEM_PROMPT = [
  "You are the ship's Mentat, a human advisor trained in cold calculation, serving the pilot of this ship.",
  'Answer in 2 to 4 sentences, in character but clear, as plain text (no markdown, no lists).',
  'Use only facts from the CONTEXT block and from your tool results. If they do not contain the answer, say the archives are silent. Never invent canon.',
  'To describe a place other than the current one, call get_lore first.',
  'The SCENE line says where the pilot is. "Here", "this planet" or "this place" means that body.',
  'When the pilot asks what they can see or where they can go HERE, call list_points_of_interest for that planet, suggest its landmarks by name with a few words on each, and offer to teleport them to one.',
  'When the pilot asks where they can go in general, call list_destinations. When they ask what is on another planet, call list_points_of_interest for it.',
  'When the pilot asks to go, travel, jump or be taken somewhere, call teleport with the matching ids, then confirm in one short sentence. Never claim a teleport you did not make with the tool.',
  'The Silent Maw is an anomaly added for this game; it is not part of Dune canon.',
].join(' ');

const MAX_ROUNDS = 4;

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface AgentRequest {
  question: string;
  context: string;
  history: ChatTurn[];
}

export interface LlmConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

/** Events the proxy streams to the browser (one JSON object per SSE message). */
export type AgentEvent =
  | { type: 'token'; text: string }
  | { type: 'tool'; name: string }
  | { type: 'action'; action: TeleportAction }
  | { type: 'done'; model: string }
  | { type: 'fallback'; reason: string };

type Message =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export async function runAgent(
  config: LlmConfig,
  request: AgentRequest,
  emit: (event: AgentEvent) => Promise<void>,
  signal?: AbortSignal,
): Promise<void> {
  const messages: Message[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'system', content: `CONTEXT\n${request.context}` },
    ...request.history.map((turn) => ({ role: turn.role, content: turn.content }) as Message),
    { role: 'user', content: request.question },
  ];
  let teleported = false;

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const { text, toolCalls } = await streamRound(config, messages, emit, signal);
    if (toolCalls.length === 0) break;

    messages.push({ role: 'assistant', content: text || null, tool_calls: toolCalls });
    for (const call of toolCalls) {
      await emit({ type: 'tool', name: call.function.name });
      let outcome = runTool(call.function.name, call.function.arguments);
      if (outcome.action) {
        if (teleported) {
          outcome = { result: JSON.stringify({ ok: false, error: 'Only one teleport per request.' }) };
        } else {
          teleported = true;
          await emit({ type: 'action', action: outcome.action });
        }
      }
      messages.push({ role: 'tool', tool_call_id: call.id, content: outcome.result });
    }
  }
  await emit({ type: 'done', model: config.model });
}

/** One streamed completion: forward text as it comes, collect tool calls. */
async function streamRound(
  config: LlmConfig,
  messages: Message[],
  emit: (event: AgentEvent) => Promise<void>,
  signal?: AbortSignal,
): Promise<{ text: string; toolCalls: ToolCall[] }> {
  const response = await fetch(`${config.baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: config.model,
      messages,
      tools: TOOL_DEFINITIONS,
      tool_choice: 'auto',
      stream: true,
      temperature: 0.3, // grounded, not creative
      max_tokens: 400,
    }),
    ...(signal ? { signal } : {}),
  });
  if (!response.ok || !response.body) {
    // Never echo the upstream body: it can contain request details.
    throw new Error(`LLM API returned ${response.status}`);
  }

  let text = '';
  const calls: ToolCall[] = [];
  const decoder = new TextDecoder();
  let buffer = '';
  const reader = response.body.getReader();

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newline: number;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') continue;

      let chunk: StreamChunk;
      try {
        chunk = JSON.parse(data) as StreamChunk;
      } catch {
        continue;
      }
      const delta = chunk.choices?.[0]?.delta;
      if (!delta) continue;
      if (typeof delta.content === 'string' && delta.content) {
        text += delta.content;
        await emit({ type: 'token', text: delta.content });
      }
      for (const part of delta.tool_calls ?? []) {
        // Tool calls arrive in fragments keyed by index: id and name first,
        // then the JSON arguments a few characters at a time.
        const index = part.index ?? 0;
        const call = (calls[index] ??= { id: '', type: 'function', function: { name: '', arguments: '' } });
        if (part.id) call.id = part.id;
        if (part.function?.name) call.function.name += part.function.name;
        if (part.function?.arguments) call.function.arguments += part.function.arguments;
      }
    }
  }

  const toolCalls = calls.filter((call) => call.function.name);
  toolCalls.forEach((call, i) => {
    if (!call.id) call.id = `call_${i}`;
  });
  return { text, toolCalls };
}

interface StreamChunk {
  choices?: Array<{
    delta?: {
      content?: string | null;
      tool_calls?: Array<{ index?: number; id?: string; function?: { name?: string; arguments?: string } }>;
    };
  }>;
}
