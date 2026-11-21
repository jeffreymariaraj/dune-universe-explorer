// Day 3. Unit I: primitives and attributes (indexed triangle meshes).
// Unit I: display lists — the three LOD geometries are built once and shared by
// every planet, the modern equivalent of compiling geometry once and reusing it.
//
// A cube-sphere: six subdivided cube faces, each vertex pushed onto the unit
// sphere. Compared with a UV sphere it has no pinched poles and nearly even
// triangle sizes, so noise displacement looks the same everywhere.
//
// Plain normalisation (p / |p|) crowds vertices towards the face centres. The
// "spherified cube" mapping below spreads them evenly:
//   x' = x sqrt(1 - y^2/2 - z^2/2 + y^2 z^2 / 3)   (and cyclically for y', z')
// It already lands on the unit sphere, so no normalise is needed.
//
// Vertices are on the UNIT sphere; the planet mesh is scaled by its radius and
// the vertex shader displaces along the direction (planet.vert.glsl). Edge
// vertices are duplicated per face, but because displacement depends only on
// the direction, duplicates land in exactly the same place: no cracks.

import * as THREE from 'three';

/** One face: its outward normal and two in-plane axes with u x v = normal. */
const FACES: ReadonlyArray<readonly [THREE.Vector3, THREE.Vector3, THREE.Vector3]> = [
  [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 1, 0)],
  [new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0)],
  [new THREE.Vector3(0, 1, 0), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, -1)],
  [new THREE.Vector3(0, -1, 0), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 1)],
  [new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0)],
  [new THREE.Vector3(0, 0, -1), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 1, 0)],
];

/** Cube point (each coordinate in [-1, 1]) -> evenly spread point on the unit sphere. */
export function spherify(x: number, y: number, z: number, out = new THREE.Vector3()): THREE.Vector3 {
  const x2 = x * x;
  const y2 = y * y;
  const z2 = z * z;
  return out.set(
    x * Math.sqrt(1 - y2 / 2 - z2 / 2 + (y2 * z2) / 3),
    y * Math.sqrt(1 - z2 / 2 - x2 / 2 + (z2 * x2) / 3),
    z * Math.sqrt(1 - x2 / 2 - y2 / 2 + (x2 * y2) / 3),
  );
}

/** Triangles in a cube-sphere with `segments` quads along each face edge. */
export function cubeSphereTriangles(segments: number): number {
  return 6 * segments * segments * 2;
}

/**
 * Build a unit cube-sphere. `segments` quads per face edge; triangles =
 * 12 * segments^2 (56 -> ~37.6k, the SYSTEM_DESIGN.md "about 40k" top LOD).
 */
export function buildCubeSphere(segments: number): THREE.BufferGeometry {
  const n = Math.max(1, Math.floor(segments));
  const vertsPerFace = (n + 1) * (n + 1);
  const positions = new Float32Array(6 * vertsPerFace * 3);
  const indices = new Uint32Array(cubeSphereTriangles(n) * 3);
  const cube = new THREE.Vector3();
  const point = new THREE.Vector3();

  let v = 0;
  let k = 0;
  FACES.forEach(([normal, uAxis, vAxis], face) => {
    const base = face * vertsPerFace;
    for (let j = 0; j <= n; j++) {
      for (let i = 0; i <= n; i++) {
        const u = (i / n) * 2 - 1;
        const w = (j / n) * 2 - 1;
        cube.copy(normal).addScaledVector(uAxis, u).addScaledVector(vAxis, w);
        spherify(cube.x, cube.y, cube.z, point);
        positions[v++] = point.x;
        positions[v++] = point.y;
        positions[v++] = point.z;
      }
    }
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const a = base + j * (n + 1) + i;
        const b = a + 1;
        const c = a + (n + 1);
        const d = c + 1;
        // Counter-clockwise seen from outside (u x v = outward normal).
        indices[k++] = a;
        indices[k++] = b;
        indices[k++] = d;
        indices[k++] = a;
        indices[k++] = d;
        indices[k++] = c;
      }
    }
  });

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  // On a unit sphere the undisplaced normal equals the position. The shader
  // recomputes the real normal after displacement.
  geometry.setAttribute('normal', new THREE.BufferAttribute(positions.slice(), 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  return geometry;
}
