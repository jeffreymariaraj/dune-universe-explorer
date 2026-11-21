// Day 10. The viva weapon: a toggle per syllabus topic (SYSTEM_DESIGN.md 11).
// Bound to the 'toggleXRay' logical action (X).
//
//   wireframe         Unit I   : primitives and the rasteriser
//   normals           Unit I   : vertex attributes
//   back faces        Unit IV  : back-face culling switched off
//   bounding spheres  Unit V   : narrow-phase collision volumes
//   octree cells      Unit V   : broad phase, coloured by occupancy
//   camera frustum    Unit IV  : the view volume, seen from a second camera
//   depth buffer      Unit IV  : visible surface detection
//   orbits + path     Unit III : line primitives, plus the predicted trajectory
//   model matrix      Unit III : the live 4x4 matrix, in homogeneous form
//
// One XRay belongs to one scene (Space or Surface) and is told what that scene
// can show through an XRayTarget; toggles a scene cannot do are greyed out.
// Every toggle is cheap to switch and puts back exactly what it changed.

import * as THREE from 'three';
import { VertexNormalsHelper } from 'three/addons/helpers/VertexNormalsHelper.js';
import type { EventBus } from '../core/EventBus';
import type { Octree } from '../physics/Octree';
import type { PostFX } from './PostFX';

/** What a scene exposes to the X-Ray panel. Optional hooks enable their toggles. */
export interface XRayTarget {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  postFX: PostFX;
  /** Mesh whose vertex normals are drawn. */
  normalsMesh?: () => THREE.Mesh | null;
  /** World-space collision spheres worth drawing right now. */
  boundingSpheres?: (out: THREE.Sphere[]) => void;
  /** The broad-phase tree and the object whose frame its cells are in. */
  octree?: { tree: Octree; frame: THREE.Object3D };
  /** Orbit lines + predicted trajectory on or off. */
  setPaths?: (visible: boolean) => void;
  /** Extra wireframe handling (e.g. planets drive theirs from tuning). */
  setWireframe?: (on: boolean) => void;
  /** The matrix shown in the panel, and what it belongs to. */
  matrix: () => { label: string; matrix: THREE.Matrix4 };
  stateName: () => string;
}

type ToggleId =
  | 'wireframe'
  | 'normals'
  | 'backFaces'
  | 'bounds'
  | 'octree'
  | 'frustum'
  | 'depth'
  | 'paths';

const TOGGLES: ReadonlyArray<{ id: ToggleId; label: string; unit: string }> = [
  { id: 'wireframe', label: 'Wireframe', unit: 'I' },
  { id: 'normals', label: 'Vertex normals', unit: 'I' },
  { id: 'backFaces', label: 'Back faces (culling off)', unit: 'IV' },
  { id: 'bounds', label: 'Bounding spheres', unit: 'V' },
  { id: 'octree', label: 'Octree cells', unit: 'V' },
  { id: 'frustum', label: 'Camera frustum', unit: 'IV' },
  { id: 'depth', label: 'Depth buffer', unit: 'IV' },
  { id: 'paths', label: 'Orbits + predicted path', unit: 'III' },
];

/** Bounding spheres drawn at once (one instanced draw call). */
const MAX_SPHERES = 256;
/** The frustum display copies the camera with a short far plane, so it fits on screen. */
const FRUSTUM_DISPLAY_FAR = 120;

export class XRay {
  private readonly panel: HTMLElement;
  private readonly matrixCells: HTMLElement[] = [];
  private readonly matrixLabel: HTMLElement;
  private readonly stateLabel: HTMLElement;
  private readonly checkboxes = new Map<ToggleId, HTMLInputElement>();
  private readonly on = new Set<ToggleId>();
  private visible = false;
  private readonly unsubscribe: () => void;

  // Saved material state, so switching a toggle off restores exactly.
  private readonly savedWireframe = new Map<THREE.Material, boolean>();
  /** Flat-shaded materials take their normal from screen-space derivatives, which are
   *  degenerate on line primitives (NaN, which bloom then smears over the whole
   *  frame). They are switched to smooth shading while drawn as wireframe. */
  private readonly savedFlat = new Map<THREE.Material, boolean>();
  private readonly savedSide = new Map<THREE.Material, THREE.Side>();

  private normals: VertexNormalsHelper | null = null;
  private spheres: THREE.InstancedMesh | null = null;
  private readonly sphereList: THREE.Sphere[] = [];
  private octreeLines: THREE.LineSegments | null = null;
  private frustumCamera: THREE.PerspectiveCamera | null = null;
  private frustumHelper: THREE.CameraHelper | null = null;
  private observer: THREE.PerspectiveCamera | null = null;
  private readonly matrixTemp = new THREE.Matrix4();
  private frame = 0;

  constructor(
    parent: HTMLElement,
    bus: EventBus,
    private readonly target: XRayTarget,
  ) {
    this.panel = document.createElement('section');
    this.panel.className = 'xray';
    this.panel.hidden = true;
    const rows = TOGGLES.map((t) => {
      const supported = this.supports(t.id);
      return `<label class="xray-row${supported ? '' : ' xray-disabled'}">
        <input type="checkbox" data-toggle="${t.id}" ${supported ? '' : 'disabled'} />
        <span>${t.label}</span><em>Unit ${t.unit}</em></label>`;
    }).join('');
    this.panel.innerHTML = `
      <header class="xray-head">X-Ray <span>X to close</span></header>
      <div class="xray-rows">${rows}</div>
      <div class="xray-matrix-head"><span data-matrix-label></span><em>Unit III</em></div>
      <div class="xray-matrix">${'<span></span>'.repeat(16)}</div>
      <div class="xray-state">state: <span data-state></span></div>
    `;
    parent.appendChild(this.panel);
    this.matrixCells.push(...this.panel.querySelectorAll<HTMLElement>('.xray-matrix span'));
    this.matrixLabel = this.panel.querySelector('[data-matrix-label]')!;
    this.stateLabel = this.panel.querySelector('[data-state]')!;
    for (const box of this.panel.querySelectorAll<HTMLInputElement>('[data-toggle]')) {
      const id = box.dataset['toggle'] as ToggleId;
      this.checkboxes.set(id, box);
      box.addEventListener('change', () => this.set(id, box.checked));
    }
    // Orbit lines and the predicted path are on by default in flight.
    if (target.setPaths) {
      this.on.add('paths');
      this.checkboxes.get('paths')!.checked = true;
    }

    this.unsubscribe = bus.on('input:trigger', ({ action }) => {
      if (action === 'toggleXRay') this.setVisible(!this.visible);
    });
  }

  get isVisible(): boolean {
    return this.visible;
  }

  /** Show or hide the panel. Hiding switches every visualisation off (paths stay as chosen). */
  setVisible(visible: boolean): void {
    this.visible = visible;
    this.panel.hidden = !visible;
    document.body.classList.toggle('xray-open', visible);
    for (const toggle of TOGGLES) {
      if (toggle.id === 'paths') continue;
      this.apply(toggle.id, visible && this.on.has(toggle.id));
    }
  }

  /** Switch one visualisation (also used by the dev console and tests). */
  set(id: ToggleId, enabled: boolean): void {
    if (!this.supports(id)) return;
    if (enabled) this.on.add(id);
    else this.on.delete(id);
    const box = this.checkboxes.get(id);
    if (box) box.checked = enabled;
    this.apply(id, id === 'paths' ? enabled : enabled && this.visible);
  }

  /** Per rendered frame, before the scene is drawn. */
  update(): void {
    if (!this.visible) return;
    const t = this.target;
    if (this.on.has('wireframe')) this.applyWireframe(true); // catches meshes created since (terrain, rocks)
    if (this.normals) this.normals.update();
    if (this.spheres && t.boundingSpheres) this.updateSpheres();
    if (this.frustumCamera && this.frustumHelper && this.observer) this.updateFrustum();

    // 10 Hz is plenty for numbers a person reads.
    if (this.frame++ % 6 === 0) {
      const { label, matrix } = t.matrix();
      this.matrixLabel.textContent = label;
      // three stores matrices column-major; show them the textbook way, row by row.
      const e = matrix.elements;
      for (let row = 0; row < 4; row++) {
        for (let col = 0; col < 4; col++) {
          this.matrixCells[row * 4 + col]!.textContent = e[col * 4 + row]!.toFixed(2);
        }
      }
      this.stateLabel.textContent = t.stateName();
    }
  }

  /** After the main image: the picture-in-picture from the observer camera. */
  renderOverlay(renderer: THREE.WebGLRenderer): void {
    if (!this.visible || !this.observer || !this.frustumHelper) return;
    const size = renderer.getSize(new THREE.Vector2());
    const width = Math.round(size.x * 0.28);
    const height = Math.round(width * 0.66);
    // Bottom-right corner (GL viewports count from the bottom-left).
    const x = size.x - width - 16;
    const y = 16;
    const savedToneMapping = renderer.toneMapping;
    const savedAutoClear = renderer.autoClear;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.autoClear = false;
    renderer.setScissorTest(true);
    renderer.setScissor(x, y, width, height);
    renderer.setViewport(x, y, width, height);
    renderer.clear(true, true, false);
    this.observer.aspect = width / height;
    this.observer.updateProjectionMatrix();
    renderer.render(this.target.scene, this.observer);
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, size.x, size.y);
    renderer.toneMapping = savedToneMapping;
    renderer.autoClear = savedAutoClear;
  }

  dispose(): void {
    for (const toggle of TOGGLES) if (toggle.id !== 'paths') this.apply(toggle.id, false);
    this.unsubscribe();
    document.body.classList.remove('xray-open');
    this.panel.remove();
  }

  // ------------------------------------------------------------------ toggles

  private supports(id: ToggleId): boolean {
    const t = this.target;
    switch (id) {
      case 'normals':
        return Boolean(t.normalsMesh);
      case 'bounds':
        return Boolean(t.boundingSpheres);
      case 'octree':
        return Boolean(t.octree);
      case 'paths':
        return Boolean(t.setPaths);
      default:
        return true;
    }
  }

  private apply(id: ToggleId, enabled: boolean): void {
    const t = this.target;
    switch (id) {
      case 'wireframe':
        t.setWireframe?.(enabled);
        this.applyWireframe(enabled);
        break;
      case 'backFaces':
        this.applyBackFaces(enabled);
        break;
      case 'normals':
        this.applyNormals(enabled);
        break;
      case 'bounds':
        this.applySpheres(enabled);
        break;
      case 'octree':
        this.applyOctree(enabled);
        break;
      case 'frustum':
        this.applyFrustum(enabled);
        break;
      case 'depth':
        t.postFX.depthView = enabled;
        break;
      case 'paths':
        t.setPaths?.(enabled);
        break;
    }
  }

  private forEachMaterial(visit: (material: THREE.Material) => void): void {
    this.target.scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh) || object.userData['xray']) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials as THREE.Material[]) visit(material);
    });
  }

  private applyWireframe(on: boolean): void {
    if (on) {
      this.forEachMaterial((material) => {
        if (!('wireframe' in material)) return;
        if (!this.savedWireframe.has(material)) this.savedWireframe.set(material, Boolean(material.wireframe));
        (material as THREE.MeshBasicMaterial).wireframe = true;
        if ('flatShading' in material && material.flatShading && !this.savedFlat.has(material)) {
          this.savedFlat.set(material, true);
          (material as THREE.MeshStandardMaterial).flatShading = false;
          material.needsUpdate = true;
        }
      });
    } else {
      for (const [material, was] of this.savedWireframe) (material as THREE.MeshBasicMaterial).wireframe = was;
      this.savedWireframe.clear();
      for (const [material, was] of this.savedFlat) {
        (material as THREE.MeshStandardMaterial).flatShading = was;
        material.needsUpdate = true;
      }
      this.savedFlat.clear();
    }
  }

  private applyBackFaces(on: boolean): void {
    if (on) {
      this.forEachMaterial((material) => {
        if (!this.savedSide.has(material)) this.savedSide.set(material, material.side);
        material.side = THREE.DoubleSide;
        material.needsUpdate = true;
      });
    } else {
      for (const [material, side] of this.savedSide) {
        material.side = side;
        material.needsUpdate = true;
      }
      this.savedSide.clear();
    }
  }

  private applyNormals(on: boolean): void {
    if (this.normals) {
      this.normals.removeFromParent();
      this.normals.dispose();
      this.normals = null;
    }
    if (!on) return;
    const mesh = this.target.normalsMesh?.() ?? null;
    if (!mesh) return;
    const radius = mesh.geometry.boundingSphere?.radius ?? 1;
    this.normals = new VertexNormalsHelper(mesh, Math.max(0.4, radius * 0.05), 0x7fd4ff);
    this.normals.userData['xray'] = true;
    this.target.scene.add(this.normals);
  }

  private applySpheres(on: boolean): void {
    if (this.spheres) {
      this.spheres.removeFromParent();
      this.spheres.geometry.dispose();
      (this.spheres.material as THREE.Material).dispose();
      this.spheres.dispose();
      this.spheres = null;
    }
    if (!on) return;
    this.spheres = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(1, 2),
      new THREE.MeshBasicMaterial({ color: 0x6cff9a, wireframe: true, transparent: true, opacity: 0.55, depthWrite: false }),
      MAX_SPHERES,
    );
    this.spheres.userData['xray'] = true;
    this.spheres.frustumCulled = false;
    this.target.scene.add(this.spheres);
  }

  private updateSpheres(): void {
    if (!this.spheres || !this.target.boundingSpheres) return;
    this.sphereList.length = 0;
    this.target.boundingSpheres(this.sphereList);
    const count = Math.min(this.sphereList.length, MAX_SPHERES);
    for (let i = 0; i < count; i++) {
      const sphere = this.sphereList[i]!;
      this.matrixTemp.makeScale(sphere.radius, sphere.radius, sphere.radius).setPosition(sphere.center);
      this.spheres.setMatrixAt(i, this.matrixTemp);
    }
    this.spheres.count = count;
    this.spheres.instanceMatrix.needsUpdate = true;
  }

  private applyOctree(on: boolean): void {
    if (this.octreeLines) {
      this.octreeLines.removeFromParent();
      this.octreeLines.geometry.dispose();
      (this.octreeLines.material as THREE.Material).dispose();
      this.octreeLines = null;
    }
    if (!on || !this.target.octree) return;
    const positions: number[] = [];
    const colors: number[] = [];
    const empty = new THREE.Color('#1f4fff');
    const full = new THREE.Color('#ff3b2f');
    const colour = new THREE.Color();
    // 12 edges of a cube as pairs of corner indices (corner bits: x, y, z).
    const edges = [0, 1, 2, 3, 4, 5, 6, 7, 0, 2, 1, 3, 4, 6, 5, 7, 0, 4, 1, 5, 2, 6, 3, 7];
    this.target.octree.tree.forEachCell(({ centre, halfSize, itemCount, depth }) => {
      if (depth === 0) return; // the root box is the whole system
      colour.copy(empty).lerp(full, Math.min(1, itemCount / 8));
      for (const corner of edges) {
        positions.push(
          centre.x + (corner & 1 ? halfSize : -halfSize),
          centre.y + (corner & 2 ? halfSize : -halfSize),
          centre.z + (corner & 4 ? halfSize : -halfSize),
        );
        colors.push(colour.r, colour.g, colour.b);
      }
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    this.octreeLines = new THREE.LineSegments(
      geometry,
      new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.6, depthWrite: false }),
    );
    this.octreeLines.userData['xray'] = true;
    this.target.octree.frame.add(this.octreeLines); // cells are in the belt's own frame
  }

  private applyFrustum(on: boolean): void {
    if (this.frustumHelper) {
      this.frustumHelper.removeFromParent();
      this.frustumHelper.dispose();
      this.frustumHelper = null;
      this.frustumCamera = null;
      this.observer = null;
    }
    if (!on) return;
    // A copy of the main camera with a short far plane, so the whole view
    // volume (near plane, far plane, four side planes) fits in the picture.
    this.frustumCamera = this.target.camera.clone();
    this.frustumCamera.far = FRUSTUM_DISPLAY_FAR;
    this.frustumHelper = new THREE.CameraHelper(this.frustumCamera);
    this.frustumHelper.userData['xray'] = true;
    // Layer 1: drawn by the observer camera only, never by the main camera.
    this.frustumHelper.layers.set(1);
    this.frustumHelper.traverse((child) => child.layers.set(1));
    this.target.scene.add(this.frustumHelper);
    this.observer = new THREE.PerspectiveCamera(50, 1.5, 0.5, 60_000);
    this.observer.layers.enableAll();
  }

  private updateFrustum(): void {
    const main = this.target.camera;
    const display = this.frustumCamera!;
    display.position.copy(main.position);
    display.quaternion.copy(main.quaternion);
    display.fov = main.fov;
    display.aspect = main.aspect;
    display.near = main.near;
    display.updateProjectionMatrix();
    display.updateMatrixWorld();
    this.frustumHelper!.update();
    // The observer hangs off to the side and above, looking at the frustum's middle.
    const middle = new THREE.Vector3(0, 0, -FRUSTUM_DISPLAY_FAR * 0.5).applyQuaternion(main.quaternion).add(main.position);
    const side = new THREE.Vector3(1, 0.7, 0.4).applyQuaternion(main.quaternion).multiplyScalar(FRUSTUM_DISPLAY_FAR * 1.1);
    this.observer!.position.copy(middle).add(side);
    this.observer!.up.copy(new THREE.Vector3(0, 1, 0).applyQuaternion(main.quaternion));
    this.observer!.lookAt(middle);
  }
}
