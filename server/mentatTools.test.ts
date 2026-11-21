import { describe, expect, it } from 'vitest';
import { runTool } from './mentatTools';

describe('Mentat tools', () => {
  it('lists every body as a destination, with landmarks on planets', () => {
    const list = JSON.parse(runTool('list_destinations', '{}').result) as Array<{ id: string; landmarks: unknown[] }>;
    expect(list.map((b) => b.id)).toContain('arrakis');
    expect(list.find((b) => b.id === 'arrakis')!.landmarks.length).toBe(3);
    expect(list.find((b) => b.id === 'anomaly')!.landmarks.length).toBe(0);
  });

  it('accepts a valid teleport and turns it into an action', () => {
    const outcome = runTool('teleport', JSON.stringify({ destination_id: 'arrakis', point_of_interest_id: 'thumper' }));
    expect(outcome.action).toEqual({ type: 'teleport', bodyId: 'arrakis', bodyName: 'Arrakis', poiId: 'thumper', poiName: 'Thumper' });
  });

  it('accepts names as well as ids', () => {
    expect(runTool('teleport', JSON.stringify({ destination_id: 'Giedi Prime' })).action?.bodyId).toBe('giedi-prime');
  });

  it('refuses invented places and landmarks, with no action', () => {
    expect(runTool('teleport', JSON.stringify({ destination_id: 'earth' })).action).toBeUndefined();
    expect(runTool('teleport', JSON.stringify({ destination_id: 'arrakis', point_of_interest_id: 'spaceport' })).action).toBeUndefined();
    expect(runTool('teleport', JSON.stringify({ destination_id: 'anomaly', point_of_interest_id: 'thumper' })).action).toBeUndefined();
  });

  it('survives malformed arguments from the model', () => {
    expect(JSON.parse(runTool('teleport', '{not json').result)).toHaveProperty('error');
    expect(JSON.parse(runTool('nonsense', '{}').result)).toHaveProperty('error');
  });
});
