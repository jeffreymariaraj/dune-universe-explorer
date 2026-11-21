import { describe, expect, it } from 'vitest';
import { TerrainManager } from './TerrainManager';

describe('TerrainManager', () => {
  const flat = (): number => 0;
  const grey = (_h: number, _n: number, out: import('three').Color) => out.setRGB(0.5, 0.5, 0.5);

  it('spreads a big rebuild over several steps', () => {
    const terrain = new TerrainManager(flat, grey, 100, 64); // 67 sample rows per chunk
    terrain.generateAround(50, 50);
    terrain.update(150, 50);
    terrain.update(150, 50);
    expect(terrain.pending).toBe(3); // still on the first chunk
    terrain.flush();
    expect(terrain.pending).toBe(0);
    expect(new Set(terrain.chunkOrigins).size).toBe(9);
    terrain.dispose();
  });

  it('builds a 3x3 window of distinct chunks around the player', () => {
    const terrain = new TerrainManager(flat, grey, 100, 4);
    terrain.generateAround(50, 50);
    const origins = new Set(terrain.chunkOrigins);
    expect(origins.size).toBe(9);
    expect(origins.has('-100,-100')).toBe(true);
    expect(origins.has('100,100')).toBe(true);
    terrain.dispose();
  });

  it('recycles the trailing column when the player crosses a cell edge', () => {
    const terrain = new TerrainManager(flat, grey, 100, 4);
    terrain.generateAround(50, 50);
    // One cell east: three chunks queued. Resolution 4 = 7 sample rows per
    // chunk, under the 8-row slice, so each step finishes one chunk.
    terrain.update(150, 50);
    expect(terrain.pending).toBe(2);
    terrain.update(150, 50);
    terrain.update(150, 50);
    expect(terrain.pending).toBe(0);
    const origins = new Set(terrain.chunkOrigins);
    expect(origins.size).toBe(9);
    for (const x of [0, 100, 200]) for (const z of [-100, 0, 100]) expect(origins.has(`${x},${z}`)).toBe(true);
    terrain.dispose();
  });
});
