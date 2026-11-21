// Day 4. Unit V: collision broad phase. Unit IV: visible surface detection
// (the same tree can drive octree culling, and X-Ray draws its cells on Day 10).
//
// A LOOSE octree over bounding spheres. Each node's cube is split into eight
// children, but every node accepts objects whose sphere fits inside its cube
// grown by half its size on every side (looseness k = 2). That fixes the
// classic octree problem where a small object straddling a split plane is stuck
// in a huge parent node: with k = 2 an object of radius r always fits in a node
// whose half-size is >= r, chosen purely by which octant its centre is in.
//
// Insert: walk down by centre octant while the child is still big enough.
// A node subdivides once it holds more than `capacity` objects.
// Query (sphere): visit only nodes whose loose cube touches the query sphere,
// test those objects' spheres, return the ids that overlap. The ship checks
// a handful of asteroids per step instead of all 2,000.
//
// Static: built once for objects that do not move (the asteroid belt).

import * as THREE from 'three';

interface Item {
  id: number;
  centre: THREE.Vector3;
  radius: number;
}

class OctreeNode {
  readonly items: Item[] = [];
  children: OctreeNode[] | null = null;

  constructor(
    readonly centre: THREE.Vector3,
    readonly halfSize: number,
    readonly depth: number,
  ) {}

  /** Does the loose cube (half-size * 2) touch a sphere? */
  looseTouches(centre: THREE.Vector3, radius: number): boolean {
    const extent = this.halfSize * 2;
    // Squared distance from the sphere centre to the box (Arvo's method).
    let distanceSq = 0;
    for (const axis of ['x', 'y', 'z'] as const) {
      const v = centre[axis];
      const min = this.centre[axis] - extent;
      const max = this.centre[axis] + extent;
      if (v < min) distanceSq += (min - v) ** 2;
      else if (v > max) distanceSq += (v - max) ** 2;
    }
    return distanceSq <= radius * radius;
  }

  /** Which of the eight children a point falls in: bit 0 = +x, 1 = +y, 2 = +z. */
  octant(point: THREE.Vector3): number {
    return (
      (point.x >= this.centre.x ? 1 : 0) |
      (point.y >= this.centre.y ? 2 : 0) |
      (point.z >= this.centre.z ? 4 : 0)
    );
  }
}

/** Per-node information for debug drawing (X-Ray, Day 10). */
export interface OctreeCell {
  centre: THREE.Vector3;
  halfSize: number;
  depth: number;
  itemCount: number;
}

export class Octree {
  private readonly root: OctreeNode;
  private count = 0;

  /**
   * @param bounds   Cube (or box; its largest side is used) containing every centre.
   * @param maxDepth Deepest level allowed (root is depth 0).
   * @param capacity Objects a node holds before it subdivides.
   */
  constructor(
    bounds: THREE.Box3,
    private readonly maxDepth = 6,
    private readonly capacity = 8,
  ) {
    const size = bounds.getSize(new THREE.Vector3());
    this.root = new OctreeNode(bounds.getCenter(new THREE.Vector3()), Math.max(size.x, size.y, size.z) / 2, 0);
  }

  get size(): number {
    return this.count;
  }

  insert(id: number, centre: THREE.Vector3, radius: number): void {
    this.insertInto(this.root, { id, centre: centre.clone(), radius });
    this.count++;
  }

  /**
   * Ids of every object whose sphere overlaps the query sphere. Appends to `out`
   * (cleared first) so a per-step caller can reuse one array.
   */
  query(centre: THREE.Vector3, radius: number, out: number[] = []): number[] {
    out.length = 0;
    this.queryNode(this.root, centre, radius, out);
    return out;
  }

  /** Visit every node, for debug drawing and statistics. */
  forEachCell(visit: (cell: OctreeCell) => void): void {
    const stack = [this.root];
    while (stack.length > 0) {
      const node = stack.pop()!;
      visit({ centre: node.centre, halfSize: node.halfSize, depth: node.depth, itemCount: node.items.length });
      if (node.children) stack.push(...node.children);
    }
  }

  clear(): void {
    this.root.items.length = 0;
    this.root.children = null;
    this.count = 0;
  }

  // ------------------------------------------------------------------ internals

  private insertInto(node: OctreeNode, item: Item): void {
    let current = node;
    // Descend while a child exists and is still big enough for the object.
    while (current.children && item.radius <= current.halfSize / 2) {
      current = current.children[current.octant(item.centre)]!;
    }
    current.items.push(item);

    if (!current.children && current.items.length > this.capacity && current.depth < this.maxDepth) {
      this.subdivide(current);
    }
  }

  private subdivide(node: OctreeNode): void {
    const quarter = node.halfSize / 2;
    node.children = [];
    for (let i = 0; i < 8; i++) {
      const centre = new THREE.Vector3(
        node.centre.x + (i & 1 ? quarter : -quarter),
        node.centre.y + (i & 2 ? quarter : -quarter),
        node.centre.z + (i & 4 ? quarter : -quarter),
      );
      node.children.push(new OctreeNode(centre, quarter, node.depth + 1));
    }
    // Push down everything small enough to fit a child's loose cube.
    const keep: Item[] = [];
    for (const item of node.items.splice(0)) {
      if (item.radius <= quarter) {
        const child = node.children[node.octant(item.centre)]!;
        child.items.push(item);
      } else {
        keep.push(item);
      }
    }
    node.items.push(...keep);
    for (const child of node.children) {
      if (child.items.length > this.capacity && child.depth < this.maxDepth) this.subdivide(child);
    }
  }

  private queryNode(node: OctreeNode, centre: THREE.Vector3, radius: number, out: number[]): void {
    if (!node.looseTouches(centre, radius)) return;
    for (const item of node.items) {
      const reach = item.radius + radius;
      if (item.centre.distanceToSquared(centre) < reach * reach) out.push(item.id);
    }
    if (node.children) {
      for (const child of node.children) this.queryNode(child, centre, radius, out);
    }
  }
}
