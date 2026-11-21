// Day 9. The Mentat's tools: what the language model may LOOK UP and DO.
//
// Agentic loop (SYSTEM_DESIGN.md section 9, "scene actions"): the model never
// moves the ship itself. It can only call these functions; the proxy runs
// them, and an accepted teleport comes back to the browser as an ACTION event,
// which the game carries out through its own state machine. Every id is checked
// against planets.json here, so the model cannot invent a destination.
//
// The data is the same planets.json the game and the lore cards use.

import { loadSystemData, type BodyData, type PlanetData } from '../src/data/systemData';

/** OpenAI-compatible tool definitions (JSON Schema parameters). */
export const TOOL_DEFINITIONS = [
  {
    type: 'function',
    function: {
      name: 'list_destinations',
      description:
        'List every place the ship can teleport to: the star, each planet and the anomaly, with the landmarks on each planet.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_points_of_interest',
      description: 'List the landmarks (points of interest) on one planet, with a short description of each.',
      parameters: {
        type: 'object',
        properties: { planet_id: { type: 'string', description: 'Planet id, e.g. "arrakis".' } },
        required: ['planet_id'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_lore',
      description: 'Read the archive entry (title, summary, trivia) for a star, planet or the anomaly.',
      parameters: {
        type: 'object',
        properties: { body_id: { type: 'string', description: 'Body id, e.g. "caladan".' } },
        required: ['body_id'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'teleport',
      description:
        'Teleport the pilot. With only destination_id: to orbit near that body. With point_of_interest_id too: land on that planet beside that landmark. Call this whenever the pilot asks to go, travel, jump or be taken somewhere.',
      parameters: {
        type: 'object',
        properties: {
          destination_id: { type: 'string', description: 'Body id from list_destinations.' },
          point_of_interest_id: {
            type: 'string',
            description: 'Optional landmark id on that planet, from list_points_of_interest.',
          },
        },
        required: ['destination_id'],
        additionalProperties: false,
      },
    },
  },
] as const;

/** What the browser is told to do after a valid teleport call. */
export interface TeleportAction {
  type: 'teleport';
  bodyId: string;
  bodyName: string;
  poiId: string | null;
  poiName: string | null;
}

export interface ToolOutcome {
  /** JSON text handed back to the model as the tool result. */
  result: string;
  /** Set when the call should make something happen in the game. */
  action?: TeleportAction;
}

function bodies(): BodyData[] {
  return loadSystemData().bodies;
}

function findBody(id: unknown): BodyData | undefined {
  if (typeof id !== 'string') return undefined;
  const key = id.trim().toLowerCase();
  return bodies().find((b) => b.id === key || b.name.toLowerCase() === key);
}

function kindOf(body: BodyData): string {
  return body.type === 'blackhole' ? 'anomaly' : body.type;
}

/** Run one tool call. Arguments come from the model: treat them as untrusted. */
export function runTool(name: string, rawArguments: string): ToolOutcome {
  let args: Record<string, unknown> = {};
  try {
    const parsed: unknown = rawArguments.trim() ? JSON.parse(rawArguments) : {};
    if (parsed && typeof parsed === 'object') args = parsed as Record<string, unknown>;
  } catch {
    return { result: JSON.stringify({ error: 'Arguments were not valid JSON.' }) };
  }

  switch (name) {
    case 'list_destinations':
      return {
        result: JSON.stringify(
          bodies().map((b) => ({
            id: b.id,
            name: b.name,
            kind: kindOf(b),
            teleportToOrbit: true,
            canLandBesideLandmarks: b.type === 'planet',
            landmarks: b.type === 'planet' ? b.pointsOfInterest.map((p) => ({ id: p.id, name: p.name })) : [],
          })),
        ),
      };

    case 'list_points_of_interest': {
      const body = findBody(args['planet_id']);
      if (!body || body.type !== 'planet') {
        return { result: JSON.stringify({ error: `No planet "${String(args['planet_id'])}". Call list_destinations.` }) };
      }
      return {
        result: JSON.stringify({
          planet: body.name,
          landmarks: body.pointsOfInterest.map((p) => ({ id: p.id, name: p.name, kind: p.kind, description: p.description })),
        }),
      };
    }

    case 'get_lore': {
      const body = findBody(args['body_id']);
      if (!body) return { result: JSON.stringify({ error: `No body "${String(args['body_id'])}".` }) };
      return { result: JSON.stringify({ name: body.name, kind: kindOf(body), ...body.lore }) };
    }

    case 'teleport': {
      const body = findBody(args['destination_id']);
      if (!body) {
        return { result: JSON.stringify({ ok: false, error: `Unknown destination "${String(args['destination_id'])}".` }) };
      }
      const poiArg = args['point_of_interest_id'];
      let poi: PlanetData['pointsOfInterest'][number] | null = null;
      if (typeof poiArg === 'string' && poiArg.trim()) {
        if (body.type !== 'planet') {
          return { result: JSON.stringify({ ok: false, error: `${body.name} has no landmarks; you can only teleport to its orbit.` }) };
        }
        const key = poiArg.trim().toLowerCase();
        poi = body.pointsOfInterest.find((p) => p.id === key || p.name.toLowerCase() === key) ?? null;
        if (!poi) {
          return { result: JSON.stringify({ ok: false, error: `No landmark "${poiArg}" on ${body.name}. Call list_points_of_interest.` }) };
        }
      }
      const where = poi ? `${poi.name} on ${body.name}` : `orbit of ${body.name}`;
      return {
        result: JSON.stringify({ ok: true, message: `Teleport to ${where} accepted. It happens as soon as you finish speaking.` }),
        action: { type: 'teleport', bodyId: body.id, bodyName: body.name, poiId: poi?.id ?? null, poiName: poi?.name ?? null },
      };
    }

    default:
      return { result: JSON.stringify({ error: `Unknown tool "${name}".` }) };
  }
}
