// Day 7. Unit I: primitives and attributes (an indexed triangle grid with
// position, normal and colour attributes). Unit V: surface deformation.
//
// One square of ground: a (resolution x resolution) grid displaced on the CPU by
// physics/terrain.ts terrainHeight() — the same function the walker's ground
// clamp will use on Day 8, so collision always agrees with what is drawn.
//
// Normals come from central differences of the height function, computed on a
// grid one sample wider than the chunk. That way the normals on a chunk's edge
// are exactly the ones its neighbour computes: no lighting seams between chunks
// (computeVertexNormals() would only see this chunk's own triangles).
//
// A chunk is recycled, not reallocated: rebuild() rewrites the same buffers for
// a new origin when the player walks away from it (TerrainManager).
//
// A full rebuild is ~17k height samples (~50 ms), too long for one frame, so
// rebuildInSlices() is a generator: it computes a few rows of heights, yields,
// and only touches the mesh once every row is done. TerrainManager advances it
// a slice per fixed step, so walking never stalls a frame.

import * as THREE from 'three';

/** Height at world (x, z). */
export type HeightFunction = (x: number, z: number) => number;
/** Vertex colour for a height and the normal's y (1 = flat, 0 = cliff). */
export type ColourFunction = (height: number, normalY: number, out: THREE.Color) => THREE.Color;

export class TerrainChunk {
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.Material>;
  originX = 0;
  originZ = 0;

  private readonly positions: Float32Array;
  private readonly normals: Float32Array;
  private readonly colors: Float32Array;
  /** Heights on a (resolution + 3)^2 grid: the chunk plus a one-sample border. */
  private readonly heights: Float32Array;
  private readonly colour = new THREE.Color();

  constructor(
    readonly size: number,
    readonly resolution: number,
    material: THREE.Material,
  ) {
    const side = resolution + 1;
    this.positions = new Float32Array(side * side * 3);
    this.normals = new Float32Array(side * side * 3);
    this.colors = new Float32Array(side * side * 3);
    this.heights = new Float32Array((resolution + 3) * (resolution + 3));

    const indices = new Uint32Array(resolution * resolution * 6);
    let k = 0;
    for (let j = 0; j < resolution; j++) {
      for (let i = 0; i < resolution; i++) {
        const a = j * side + i;
        const b = a + 1;
        const c = a + side;
        const d = c + 1;
        // Counter-clockwise seen from above (+y): a, c, b and b, c, d.
        indices[k++] = a;
        indices[k++] = c;
        indices[k++] = b;
        indices[k++] = b;
        indices[k++] = c;
        indices[k++] = d;
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(this.normals, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.name = 'TerrainChunk';
  }

  /** Regenerate this chunk for the square starting at world (originX, originZ), all at once. */
  rebuild(originX: number, originZ: number, heightAt: HeightFunction, colourAt: ColourFunction): void {
    for (const _ of this.rebuildInSlices(originX, originZ, heightAt, colourAt, Infinity)) {
      /* run to completion */
    }
  }

  /**
   * The same rebuild as a generator: yields after every `rowsPerSlice` rows of
   * height samples, then writes the mesh in one go at the end.
   */
  *rebuildInSlices(
    originX: number,
    originZ: number,
    heightAt: HeightFunction,
    colourAt: ColourFunction,
    rowsPerSlice: number,
  ): Generator<void, void, void> {
    const n = this.resolution;
    const step = this.size / n;
    const wide = n + 3;

    // 1. Heights, including a one-sample border for the normals.
    let rows = 0;
    for (let j = 0; j < wide; j++) {
      for (let i = 0; i < wide; i++) {
        this.heights[j * wide + i] = heightAt(originX + (i - 1) * step, originZ + (j - 1) * step);
      }
      if (++rows >= rowsPerSlice && j < wide - 1) {
        rows = 0;
        yield;
      }
    }
    this.originX = originX;
    this.originZ = originZ;

    // 2. Positions (local to the chunk), normals by central differences, colours.
    const side = n + 1;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let j = 0; j <= n; j++) {
      for (let i = 0; i <= n; i++) {
        const h = this.heights[(j + 1) * wide + (i + 1)]!;
        const hl = this.heights[(j + 1) * wide + i]!;
        const hr = this.heights[(j + 1) * wide + (i + 2)]!;
        const hd = this.heights[j * wide + (i + 1)]!;
        const hu = this.heights[(j + 2) * wide + (i + 1)]!;
        // n = (-dh/dx, 1, -dh/dz), normalised
        let nx = (hl - hr) / (2 * step);
        let nz = (hd - hu) / (2 * step);
        let ny = 1;
        const length = Math.hypot(nx, ny, nz);
        nx /= length;
        ny /= length;
        nz /= length;

        const v = j * side + i;
        this.positions[v * 3 + 0] = i * step;
        this.positions[v * 3 + 1] = h;
        this.positions[v * 3 + 2] = j * step;
        this.normals[v * 3 + 0] = nx;
        this.normals[v * 3 + 1] = ny;
        this.normals[v * 3 + 2] = nz;
        colourAt(h, ny, this.colour);
        this.colors[v * 3 + 0] = this.colour.r;
        this.colors[v * 3 + 1] = this.colour.g;
        this.colors[v * 3 + 2] = this.colour.b;
        minY = Math.min(minY, h);
        maxY = Math.max(maxY, h);
      }
    }

    const geometry = this.mesh.geometry;
    geometry.getAttribute('position').needsUpdate = true;
    geometry.getAttribute('normal').needsUpdate = true;
    geometry.getAttribute('color').needsUpdate = true;
    // Exact bounds for frustum culling (Unit IV).
    geometry.boundingBox = new THREE.Box3(new THREE.Vector3(0, minY, 0), new THREE.Vector3(this.size, maxY, this.size));
    geometry.boundingSphere = geometry.boundingBox.getBoundingSphere(new THREE.Sphere());
    this.mesh.position.set(originX, 0, originZ);
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
  }
}
