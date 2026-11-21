// Day 7. Streams a 3x3 grid of TerrainChunks around the player, recycling the
// chunks that fall off the trailing edge instead of allocating new ones — nine
// chunks of 128x128 quads is the whole surface budget (SYSTEM_DESIGN.md 12).
//
// When the player crosses into a new cell, the chunks no longer in the 3x3
// window are handed the new cells and queued. Each update advances the front
// job by ROWS_PER_STEP rows of samples (TerrainChunk.rebuildInSlices), so a
// crossing costs a few milliseconds per step instead of one long hitch.
// Fog hides the edge of the window (SurfaceScene).

import * as THREE from 'three';
import { TerrainChunk, type ColourFunction, type HeightFunction } from './TerrainChunk';

/** Height-sample rows computed per fixed step while a chunk is being rebuilt (~3 ms). */
const ROWS_PER_STEP = 8;

export class TerrainManager {
  readonly root = new THREE.Group();
  readonly material: THREE.MeshStandardMaterial;

  private readonly chunks: TerrainChunk[] = [];
  /** Cell key ("i,j") -> chunk currently showing that cell. */
  private readonly byCell = new Map<string, TerrainChunk>();
  private readonly queue: Array<{ chunk: TerrainChunk; i: number; j: number }> = [];
  /** The rebuild in progress for queue[0], if started. */
  private job: Generator<void, void, void> | null = null;
  private centreI = Number.NaN;
  private centreJ = Number.NaN;

  constructor(
    private readonly heightAt: HeightFunction,
    private readonly colourAt: ColourFunction,
    readonly chunkSize = 256,
    readonly resolution = 128,
  ) {
    this.root.name = 'Terrain';
    this.material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.95,
      metalness: 0,
    });
    for (let n = 0; n < 9; n++) {
      const chunk = new TerrainChunk(chunkSize, resolution, this.material);
      this.chunks.push(chunk);
      this.root.add(chunk.mesh);
    }
  }

  /** Build all nine chunks around (x, z) right now (scene load, behind the warp fade). */
  generateAround(x: number, z: number): void {
    this.queue.length = 0;
    this.job = null;
    this.byCell.clear();
    this.centreI = Math.floor(x / this.chunkSize);
    this.centreJ = Math.floor(z / this.chunkSize);
    let n = 0;
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        const chunk = this.chunks[n++]!;
        const i = this.centreI + di;
        const j = this.centreJ + dj;
        chunk.rebuild(i * this.chunkSize, j * this.chunkSize, this.heightAt, this.colourAt);
        this.byCell.set(key(i, j), chunk);
      }
    }
  }

  /** Fixed step: re-centre the window on the player and advance the current rebuild. */
  update(x: number, z: number): void {
    const ci = Math.floor(x / this.chunkSize);
    const cj = Math.floor(z / this.chunkSize);
    if (ci !== this.centreI || cj !== this.centreJ) this.recentre(ci, cj);
    this.advance(ROWS_PER_STEP);
  }

  /** Finish every queued rebuild now (tests, and teleports behind a fade). */
  flush(): void {
    while (this.queue.length > 0) this.advance(Infinity);
  }

  private advance(rows: number): void {
    const front = this.queue[0];
    if (!front) return;
    this.job ??= front.chunk.rebuildInSlices(
      front.i * this.chunkSize,
      front.j * this.chunkSize,
      this.heightAt,
      this.colourAt,
      rows,
    );
    if (this.job.next().done) {
      this.job = null;
      this.queue.shift();
    }
  }

  /** The chunk mesh under world (x, z), if built (X-Ray normals). */
  meshAt(x: number, z: number): THREE.Mesh | null {
    const chunk = this.byCell.get(key(Math.floor(x / this.chunkSize), Math.floor(z / this.chunkSize)));
    return chunk ? chunk.mesh : null;
  }

  /** World origins of all nine chunks, "x,z" (tests and debug). */
  get chunkOrigins(): string[] {
    return this.chunks.map((chunk) => `${chunk.originX},${chunk.originZ}`);
  }

  /** Cells still waiting for their chunk to be rebuilt (debug readout). */
  get pending(): number {
    return this.queue.length;
  }

  private recentre(ci: number, cj: number): void {
    this.centreI = ci;
    this.centreJ = cj;
    const wanted = new Set<string>();
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) wanted.add(key(ci + di, cj + dj));

    // Chunks outside the window are free for reuse.
    const free: TerrainChunk[] = [];
    for (const [cell, chunk] of this.byCell) {
      if (!wanted.has(cell)) {
        this.byCell.delete(cell);
        free.push(chunk);
      }
    }
    // Drop queued jobs for cells that are no longer wanted (the one in
    // progress too: its half-written heights are simply overwritten later).
    for (let q = this.queue.length - 1; q >= 0; q--) {
      const job = this.queue[q]!;
      if (!wanted.has(key(job.i, job.j))) {
        free.push(job.chunk);
        this.queue.splice(q, 1);
        if (q === 0) this.job = null;
      }
    }
    // Hand each free chunk a missing cell, nearest cells first.
    const missing = [...wanted]
      .filter((cell) => !this.byCell.has(cell) && !this.queue.some((job) => key(job.i, job.j) === cell))
      .map((cell) => cell.split(',').map(Number) as [number, number])
      .sort((a, b) => Math.abs(a[0] - ci) + Math.abs(a[1] - cj) - (Math.abs(b[0] - ci) + Math.abs(b[1] - cj)));
    for (const [i, j] of missing) {
      const chunk = free.pop();
      if (!chunk) break;
      this.byCell.set(key(i, j), chunk);
      this.queue.push({ chunk, i, j });
    }
  }

  dispose(): void {
    for (const chunk of this.chunks) chunk.dispose();
    this.chunks.length = 0;
    this.byCell.clear();
    this.queue.length = 0;
    this.job = null;
    this.material.dispose();
    this.root.removeFromParent();
  }
}

function key(i: number, j: number): string {
  return `${i},${j}`;
}
