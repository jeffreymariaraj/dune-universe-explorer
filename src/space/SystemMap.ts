// Day 10. Unit IV: projections — the same scene through an ORTHOGRAPHIC camera.
//
// Toggle with O. A camera high above the system looks straight down with a
// parallel projection: no perspective divide, so distances on screen are true
// to scale everywhere and every orbit is drawn at its real shape. Compare with
// the flight view's perspective projection, where size falls off as 1/z.
//
//   perspective   x_screen = f * x / (-z)        (things shrink with distance)
//   orthographic  x_screen = x * 2 / width       (no divide by z)
//
// At this scale a planet is only a few pixels across, so map-only markers
// (rings, labels, a ship arrow) are drawn on layer 2, which only the map camera
// renders. They are resized every frame to stay a fixed number of pixels.

import * as THREE from 'three';

/** Layer the map markers live on; the flight camera never renders it. */
export const MAP_LAYER = 2;
/** Half the height of the visible map, world units (covers the anomaly's orbit). */
const HALF_HEIGHT = 29_000;

interface Marker {
  id: string;
  ring: THREE.Mesh;
  label: THREE.Sprite;
  /** Minimum on-screen ring radius in pixels. */
  pixels: number;
  radius: number;
}

export class SystemMap {
  readonly camera: THREE.OrthographicCamera;
  readonly root = new THREE.Group();
  private readonly markers: Marker[] = [];
  private readonly ship: THREE.Mesh;
  private readonly disposables: Array<THREE.BufferGeometry | THREE.Material | THREE.Texture> = [];
  private viewportHeight = 1080;

  constructor(bodies: ReadonlyArray<{ id: string; name: string; radius: number; color: string }>) {
    this.root.name = 'SystemMap';
    this.camera = new THREE.OrthographicCamera(-HALF_HEIGHT, HALF_HEIGHT, HALF_HEIGHT, -HALF_HEIGHT, 1, 90_000);
    this.camera.name = 'MapCamera';
    this.camera.position.set(0, 45_000, 0);
    this.camera.up.set(0, 0, -1); // north (-Z) at the top of the screen
    this.camera.lookAt(0, 0, 0);
    this.camera.layers.enable(MAP_LAYER);

    const ringGeometry = new THREE.RingGeometry(0.82, 1, 48).rotateX(-Math.PI / 2);
    this.disposables.push(ringGeometry);
    for (const body of bodies) {
      const material = new THREE.MeshBasicMaterial({ color: body.color, transparent: true, opacity: 0.9, depthTest: false });
      const ring = new THREE.Mesh(ringGeometry, material);
      ring.layers.set(MAP_LAYER);
      ring.renderOrder = 10;
      const label = this.makeLabel(body.name);
      label.layers.set(MAP_LAYER);
      this.disposables.push(material);
      this.root.add(ring, label);
      this.markers.push({ id: body.id, ring, label, pixels: 7, radius: body.radius });
    }

    const arrow = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, -1.4),
      new THREE.Vector3(-0.8, 0, 0.9),
      new THREE.Vector3(0.8, 0, 0.9),
    ]);
    arrow.setIndex([0, 1, 2]);
    const arrowMaterial = new THREE.MeshBasicMaterial({ color: 0x7fd4ff, side: THREE.DoubleSide, depthTest: false });
    this.ship = new THREE.Mesh(arrow, arrowMaterial);
    this.ship.layers.set(MAP_LAYER);
    this.ship.renderOrder = 11;
    this.root.add(this.ship);
    this.disposables.push(arrow, arrowMaterial);
  }

  resize(width: number, height: number): void {
    const aspect = width / Math.max(height, 1);
    this.camera.left = -HALF_HEIGHT * aspect;
    this.camera.right = HALF_HEIGHT * aspect;
    this.camera.top = HALF_HEIGHT;
    this.camera.bottom = -HALF_HEIGHT;
    this.camera.updateProjectionMatrix();
    this.viewportHeight = height;
  }

  /** Per rendered frame while the map is shown. */
  update(
    positionOf: (id: string, out: THREE.Vector3) => THREE.Vector3 | null,
    shipPosition: THREE.Vector3,
    shipForward: THREE.Vector3,
  ): void {
    // World units per screen pixel: the orthographic window-to-viewport scale.
    const unitsPerPixel = (2 * HALF_HEIGHT) / this.viewportHeight;
    const position = new THREE.Vector3();
    for (const marker of this.markers) {
      if (!positionOf(marker.id, position)) continue;
      const radius = Math.max(marker.radius * 1.6, marker.pixels * unitsPerPixel);
      marker.ring.position.copy(position).setY(0);
      marker.ring.scale.setScalar(radius);
      marker.label.position.set(position.x, 0, position.z + radius + 9 * unitsPerPixel);
      marker.label.scale.set(marker.label.userData['aspect'] * 13 * unitsPerPixel, 13 * unitsPerPixel, 1);
    }
    this.ship.position.copy(shipPosition).setY(0);
    this.ship.scale.setScalar(8 * unitsPerPixel);
    this.ship.rotation.y = Math.atan2(-shipForward.x, -shipForward.z);
  }

  dispose(): void {
    for (const marker of this.markers) {
      (marker.label.material as THREE.SpriteMaterial).map?.dispose();
      marker.label.material.dispose();
    }
    for (const item of this.disposables) item.dispose();
    this.markers.length = 0;
    this.root.removeFromParent();
    this.root.clear();
  }

  /** A text label drawn once onto a canvas. */
  private makeLabel(text: string): THREE.Sprite {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d')!;
    const font = '500 44px ui-monospace, Menlo, monospace';
    context.font = font;
    const width = Math.ceil(context.measureText(text.toUpperCase()).width) + 16;
    canvas.width = width;
    canvas.height = 60;
    context.font = font;
    context.fillStyle = '#e8c27a';
    context.textBaseline = 'middle';
    context.fillText(text.toUpperCase(), 8, 32);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true }));
    sprite.userData['aspect'] = width / 60;
    sprite.renderOrder = 12;
    return sprite;
  }
}
