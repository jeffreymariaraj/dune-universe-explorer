// Day 9. Grounding for the Mentat.
//
// Assembles the prompt CONTEXT block from the current scene state (in flight or
// landed, nearest body, distance, nearest landmark) and the lore entry for that
// body straight out of planets.json. The lore file is the single source of
// truth, so the advisor and the lore cards can never disagree
// (SYSTEM_DESIGN.md section 9). The last four chat turns travel separately as
// chat history. Pure function: tested in contextBuilder.test.ts.

import type { BodyData } from '../data/systemData';

/** What the panel knows about where the pilot is, from EventBus messages. */
export interface SceneSnapshot {
  state: 'Space' | 'Surface' | 'Warp' | 'Other';
  /** Space: nearest body; Surface: the planet underfoot. */
  bodyId: string | null;
  /** Space only: distance to that body's surface. */
  altitude: number | null;
  /** Space only: that body's radius, to tell "in orbit of" from "passing". */
  radius?: number;
  /** Surface only: nearest landmark and its distance. */
  nearestPoi: string | null;
  poiDistance: number | null;
}

/** Within this many radii of a body, the ship counts as "in orbit" of it ("here"). */
export const ORBIT_RADII = 12;

export function buildContext(scene: SceneSnapshot, bodies: readonly BodyData[]): string {
  const lines: string[] = [];
  const body = bodies.find((b) => b.id === scene.bodyId) ?? null;

  if (scene.state === 'Surface' && body) {
    lines.push(`SCENE: The pilot has landed and is on foot on ${body.name}. "Here" means ${body.name}.`);
    if (scene.nearestPoi) {
      lines.push(`Nearest landmark: ${scene.nearestPoi}, ${Math.round(scene.poiDistance ?? 0)} units away.`);
    }
  } else if (scene.state === 'Space' && body) {
    const altitude = Math.max(0, scene.altitude ?? 0);
    const radius = scene.radius ?? 0;
    if (radius > 0 && altitude < radius * ORBIT_RADII) {
      lines.push(`SCENE: The ship is in orbit of ${body.name}, ${Math.round(altitude)} units above it. "Here" means ${body.name}.`);
    } else {
      lines.push(`SCENE: The ship is in flight. Nearest body: ${body.name}, ${Math.round(altitude)} units from its surface.`);
    }
  } else {
    lines.push('SCENE: The ship is between places.');
  }

  if (body) {
    lines.push('', `ARCHIVE ENTRY: ${body.name} (${body.type === 'blackhole' ? 'anomaly, not Dune canon' : body.type})`);
    lines.push(`Title: ${body.lore.title}`, `Summary: ${body.lore.summary}`);
    for (const fact of body.lore.trivia) lines.push(`- ${fact}`);
    if (body.type === 'planet' && body.pointsOfInterest.length > 0) {
      lines.push(`Landmarks on ${body.name}: ${body.pointsOfInterest.map((p) => `${p.name} (${p.id})`).join(', ')}.`);
    }
  }

  lines.push('', `Known places: ${bodies.map((b) => `${b.name} (${b.id})`).join(', ')}.`);
  return lines.join('\n');
}
