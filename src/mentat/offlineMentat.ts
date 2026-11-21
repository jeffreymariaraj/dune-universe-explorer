// Day 9. The Mentat without a network: a small rule-based responder over
// planets.json, used when the proxy is down, has no key, or the model fails.
// It covers the demo's questions — "tell me about X", "where can I go",
// "what is on X", "take me to X" — and can still issue teleports, so the viva
// never depends on venue Wi-Fi or a rate limit (SYSTEM_DESIGN.md section 13).
//
// Every answer is built from planets.json text, so it is always on-lore.

import type { BodyData, PlanetData } from '../data/systemData';
import type { SceneSnapshot } from './contextBuilder';

export interface OfflineAnswer {
  text: string;
  teleport?: { bodyId: string; poiId: string | null };
}

const TRAVEL = /\b(teleport|take me|bring me|go to|travel|jump to|fly me|send me|warp to|move me)\b/i;
const DESTINATIONS = /\b(where can i|destinations?|which planets|what planets|places can i|list (the )?planets)\b/i;
const LANDMARKS = /\b(landmarks?|points? of interest|attractions?|what('s| is) (there|on|here)|sights?|what can i (see|visit|do))\b/i;
/** "here", "this planet", "this world": the body under the ship or the walker. */
const HERE = /\b(here|this (planet|world|place))\b/i;

function mentioned(question: string, bodies: readonly BodyData[]): BodyData | null {
  const q = question.toLowerCase();
  return bodies.find((b) => q.includes(b.name.toLowerCase()) || q.includes(b.id.replace('-', ' '))) ?? null;
}

function mentionedPoi(question: string, bodies: readonly BodyData[]): { planet: PlanetData; poiId: string; name: string } | null {
  const q = question.toLowerCase();
  for (const body of bodies) {
    if (body.type !== 'planet') continue;
    for (const poi of body.pointsOfInterest) {
      if (q.includes(poi.name.toLowerCase()) || q.includes(poi.id.replace(/-/g, ' '))) {
        return { planet: body, poiId: poi.id, name: poi.name };
      }
    }
  }
  return null;
}

function landmarksOf(planet: PlanetData): OfflineAnswer {
  const names = planet.pointsOfInterest.map((p) => `the ${p.name}`);
  const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : (names[0] ?? 'nothing on record');
  const first = planet.pointsOfInterest[0];
  return {
    text:
      `On ${planet.name} you can visit ${list}.` +
      (first ? ` ${first.name}: ${first.description}` : '') +
      ' Say "take me to" any of them and I will set you down beside it.',
  };
}

export function answerOffline(question: string, scene: SceneSnapshot, bodies: readonly BodyData[]): OfflineAnswer {
  const here = bodies.find((b) => b.id === scene.bodyId) ?? null;
  const poi = mentionedPoi(question, bodies);
  const body = poi?.planet ?? mentioned(question, bodies) ?? null;

  if (TRAVEL.test(question)) {
    if (poi) return { text: `Plotting a jump to the ${poi.name} on ${poi.planet.name}.`, teleport: { bodyId: poi.planet.id, poiId: poi.poiId } };
    if (body) return { text: `Plotting a jump to the orbit of ${body.name}.`, teleport: { bodyId: body.id, poiId: null } };
    return { text: 'Name the destination, my lord, and I will plot the jump.' };
  }

  // "Where can I go here?" / "What can I see here?" -> this planet's landmarks.
  if (HERE.test(question) && !body && here?.type === 'planet' && (DESTINATIONS.test(question) || LANDMARKS.test(question))) {
    return landmarksOf(here);
  }

  if (DESTINATIONS.test(question)) {
    const planets = bodies.filter((b): b is PlanetData => b.type === 'planet');
    const others = bodies.filter((b) => b.type !== 'planet').map((b) => b.name);
    return {
      text:
        `We can jump to ${planets.map((p) => p.name).join(', ')}, or to the orbit of ${others.join(' or ')}. ` +
        'On any planet I can set you down beside one of its landmarks.',
    };
  }

  if (LANDMARKS.test(question)) {
    const planet = (body ?? here)?.type === 'planet' ? ((body ?? here) as PlanetData) : null;
    if (!planet) return { text: 'Only the planets have landmarks on record. Name one, my lord.' };
    return landmarksOf(planet);
  }

  const subject = body ?? here;
  if (subject) {
    const fact = subject.lore.trivia[0] ? ` ${subject.lore.trivia[0]}` : '';
    return { text: `${subject.name}: ${subject.lore.title}. ${subject.lore.summary}${fact}` };
  }
  return { text: 'The archives are silent on that, my lord.' };
}
