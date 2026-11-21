import { describe, expect, it } from 'vitest';
import { loadSystemData } from '../data/systemData';
import { buildContext, type SceneSnapshot } from './contextBuilder';
import { answerOffline } from './offlineMentat';

const bodies = loadSystemData().bodies;
const inSpace: SceneSnapshot = { state: 'Space', bodyId: 'caladan', altitude: 812, radius: 240, nearestPoi: null, poiDistance: null };
const farOut: SceneSnapshot = { state: 'Space', bodyId: 'caladan', altitude: 9000, radius: 240, nearestPoi: null, poiDistance: null };
const onArrakis: SceneSnapshot = { state: 'Surface', bodyId: 'arrakis', altitude: null, nearestPoi: 'Thumper', poiDistance: 41.6 };

describe('buildContext', () => {
  it('describes flight with the nearest body and its archive entry from planets.json', () => {
    const context = buildContext(inSpace, bodies);
    expect(context).toContain('in orbit of Caladan, 812 units');
    expect(context).toContain('"Here" means Caladan');
    expect(context).toContain('The Ocean World');
    expect(context).toContain('Fishing Buoy (fishing-buoy)');
  });

  it('describes being on foot with the nearest landmark', () => {
    const context = buildContext(onArrakis, bodies);
    expect(context).toContain('on foot on Arrakis');
    expect(context).toContain('Nearest landmark: Thumper, 42 units');
  });

  it('marks the anomaly as not canon', () => {
    const context = buildContext({ ...inSpace, bodyId: 'anomaly' }, bodies);
    expect(context).toContain('not Dune canon');
  });
});

describe('"here"', () => {
  it('only counts as orbit when close to the body', () => {
    expect(buildContext(farOut, bodies)).toContain('in flight');
    expect(buildContext(farOut, bodies)).not.toContain('"Here"');
  });

  it('suggests this planet\'s landmarks for "what can I see here" in orbit', () => {
    const answer = answerOffline('What can I see here?', inSpace, bodies);
    expect(answer.text).toContain('Fishing Buoy');
    expect(answer.text).toContain('Sea-cliff Watchtower');
    expect(answer.teleport).toBeUndefined();
  });

  it('suggests this planet\'s landmarks for "where can I go here" on foot', () => {
    const answer = answerOffline('Where can I go here?', onArrakis, bodies);
    expect(answer.text).toContain('Thumper');
    expect(answer.text).not.toContain('Kaitain');
  });
});

describe('answerOffline', () => {
  it('teleports to a planet orbit by name', () => {
    expect(answerOffline('Take me to Kaitain', inSpace, bodies).teleport).toEqual({ bodyId: 'kaitain', poiId: null });
  });

  it('teleports to a landmark by name, on whichever planet it is', () => {
    expect(answerOffline('teleport me to the sietch doorway', inSpace, bodies).teleport).toEqual({
      bodyId: 'arrakis',
      poiId: 'sietch-door',
    });
  });

  it('lists destinations', () => {
    const answer = answerOffline('Where can I go?', inSpace, bodies);
    expect(answer.text).toContain('Arrakis');
    expect(answer.text).toContain('The Silent Maw');
    expect(answer.teleport).toBeUndefined();
  });

  it('lists the landmarks of the planet underfoot', () => {
    expect(answerOffline('What landmarks are there?', onArrakis, bodies).text).toContain('Abandoned Harvester');
  });

  it('answers lore questions from planets.json', () => {
    expect(answerOffline('Tell me about Giedi Prime', inSpace, bodies).text).toContain('Harkonnen');
  });
});
