// Unit I: primitives and attributes (point primitives with per-vertex attributes).
// Unit IV: view volume — the sky shell draws with the depth test off so it can
// never be clipped, which is what makes a skybox look infinitely far away.
//
// Two layers, as in SYSTEM_DESIGN.md section 7:
//   1. sky      : a cubemap from public/skybox/ if present, otherwise a procedural
//                 Points shell generated here, so the app always has a sky.
//   2. parallax : a sparse dust field wrapped around the camera in the shader,
//                 so you can see your own motion.
//
// Cubemap faces are generated with wwwtyro/space-3d (Unlicense) — see
// ASSETS_AND_CREDITS.md. Drop px/nx/py/ny/pz/nz.png into public/skybox/.

import * as THREE from 'three';
import type { AssetLoader } from '../core/AssetLoader';
import starfieldVertex from '../shaders/starfield.vert.glsl';
import starfieldFragment from '../shaders/starfield.frag.glsl';

/** three's CubeTextureLoader face order: +X, -X, +Y, -Y, +Z, -Z. */
export const CUBEMAP_FACES = ['px.png', 'nx.png', 'py.png', 'ny.png', 'pz.png', 'nz.png'] as const;
const CUBEMAP_PATH = '/skybox/';

export type SkyMode = 'cubemap' | 'procedural';

export interface SkyboxOptions {
  /** Stars on the fallback shell. */
  shellStars?: number;
  /** Motes in the near parallax field. */
  dustMotes?: number;
  /** Side length of the cube the dust field is wrapped into. */
  dustExtent?: number;
}

export class Skybox {
  private readonly group = new THREE.Group();
  private readonly materials: THREE.ShaderMaterial[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];
  private cubeTexture: THREE.CubeTexture | null = null;
  private shell: THREE.Points | null = null;
  private dust: THREE.Points | null = null;
  private mode: SkyMode = 'procedural';
  private readonly options: Required<SkyboxOptions>;

  constructor(
    private readonly assets: AssetLoader,
    options: SkyboxOptions = {},
  ) {
    this.group.name = 'Skybox';
    this.options = {
      shellStars: options.shellStars ?? 4000,
      dustMotes: options.dustMotes ?? 1200,
      dustExtent: options.dustExtent ?? 2600,
    };
  }

  get object3D(): THREE.Group {
    return this.group;
  }

  get skyMode(): SkyMode {
    return this.mode;
  }

  /**
   * Try the cubemap; fall back to the procedural shell. The parallax dust layer
   * is built either way. Safe to call once per scene load.
   */
  async load(scene: THREE.Scene, pixelRatio: number): Promise<SkyMode> {
    this.cubeTexture = await this.assets.loadCubeTexture(CUBEMAP_PATH, CUBEMAP_FACES);

    if (this.cubeTexture) {
      this.mode = 'cubemap';
      scene.background = this.cubeTexture;
    } else {
      this.mode = 'procedural';
      scene.background = new THREE.Color(0x05060b);
      this.shell = this.buildShell(pixelRatio);
      this.group.add(this.shell);
    }

    this.dust = this.buildDust(pixelRatio);
    this.group.add(this.dust);
    scene.add(this.group);
    return this.mode;
  }

  /** Call once per rendered frame. */
  update(elapsed: number, cameraPosition: THREE.Vector3): void {
    // The shell rides with the camera, so it reads as infinitely distant.
    this.shell?.position.copy(cameraPosition);
    for (const material of this.materials) {
      material.uniforms['uTime']!.value = elapsed;
      material.uniforms['uCameraPos']!.value.copy(cameraPosition);
    }
  }

  setPixelRatio(pixelRatio: number): void {
    for (const material of this.materials) {
      material.uniforms['uPixelRatio']!.value = pixelRatio;
    }
  }

  // ------------------------------------------------------------------ geometry

  /** Stars distributed evenly over a sphere (not evenly in angle — that clumps at the poles). */
  private buildShell(pixelRatio: number): THREE.Points {
    const count = this.options.shellStars;
    // Just inside the camera's far plane (60,000) and outside the whole system
    // (+/-50,000 per SYSTEM_DESIGN.md section 5), so every real object is in
    // front of the sky and ordinary depth testing hides the stars behind it.
    const radius = 55_000;
    const positions = new Float32Array(count * 3);
    const random = makeRandom(10191); // system seed from planets.json

    for (let i = 0; i < count; i++) {
      // Uniform on a sphere: z uniform in [-1, 1], angle uniform in [0, 2pi).
      const z = random() * 2 - 1;
      const angle = random() * Math.PI * 2;
      const ring = Math.sqrt(1 - z * z);
      positions[i * 3 + 0] = radius * ring * Math.cos(angle);
      positions[i * 3 + 1] = radius * ring * Math.sin(angle);
      positions[i * 3 + 2] = radius * z;
    }

    const geometry = this.buildPointGeometry(positions, count, random, 1.0);
    const material = this.buildPointMaterial(pixelRatio, {
      wrapExtent: 0,
      fadeDistance: 0,
      // Stars keep their base pixel size no matter how far the shell sits.
      sizeRef: radius,
    });

    const points = new THREE.Points(geometry, material);
    points.name = 'StarShell';
    points.frustumCulled = false; // the shell always surrounds the camera
    points.renderOrder = -1000; // first among transparent objects
    return points;
  }

  /** Near-field motes, wrapped around the camera in the vertex shader. */
  private buildDust(pixelRatio: number): THREE.Points {
    const count = this.options.dustMotes;
    const extent = this.options.dustExtent;
    const positions = new Float32Array(count * 3);
    const random = makeRandom(7041); // Arrakis seed, reused so the field is stable

    for (let i = 0; i < count; i++) {
      positions[i * 3 + 0] = (random() - 0.5) * extent;
      positions[i * 3 + 1] = (random() - 0.5) * extent;
      positions[i * 3 + 2] = (random() - 0.5) * extent;
    }

    const geometry = this.buildPointGeometry(positions, count, random, 0.55);
    const material = this.buildPointMaterial(pixelRatio, {
      wrapExtent: extent,
      fadeDistance: extent * 0.5,
      sizeRef: 300,
    });

    const points = new THREE.Points(geometry, material);
    points.name = 'ParallaxDust';
    points.frustumCulled = false; // the shader moves vertices, so the bounds lie
    return points;
  }

  private buildPointGeometry(
    positions: Float32Array,
    count: number,
    random: () => number,
    sizeScale: number,
  ): THREE.BufferGeometry {
    const sizes = new Float32Array(count);
    const twinkles = new Float32Array(count);
    const colors = new Float32Array(count * 3);
    const warm = new THREE.Color('#ffd7a8');
    const cool = new THREE.Color('#cfe3ff');
    const colour = new THREE.Color();

    for (let i = 0; i < count; i++) {
      // Most stars are faint; a few are bright. Cubing the random does that.
      const brightness = random();
      sizes[i] = (0.8 + brightness * brightness * brightness * 3.2) * sizeScale;
      twinkles[i] = random();
      colour.copy(cool).lerp(warm, random() * random());
      colors[i * 3 + 0] = colour.r;
      colors[i * 3 + 1] = colour.g;
      colors[i * 3 + 2] = colour.b;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute('aTwinkle', new THREE.BufferAttribute(twinkles, 1));
    geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
    this.geometries.push(geometry);
    return geometry;
  }

  private buildPointMaterial(
    pixelRatio: number,
    config: { wrapExtent: number; fadeDistance: number; sizeRef: number },
  ): THREE.ShaderMaterial {
    const material = new THREE.ShaderMaterial({
      vertexShader: starfieldVertex,
      fragmentShader: starfieldFragment,
      uniforms: {
        uTime: { value: 0 },
        uPixelRatio: { value: pixelRatio },
        uSizeScale: { value: 1 },
        uWrapExtent: { value: config.wrapExtent },
        uCameraPos: { value: new THREE.Vector3() },
        uFadeDistance: { value: config.fadeDistance },
        uSizeRef: { value: config.sizeRef },
      },
      transparent: true,
      // Depth TEST stays on so the hull and (from Day 2) the planets occlude the
      // sky; depth WRITE is off so stars never occlude each other.
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.materials.push(material);
    return material;
  }

  /** Release every GPU resource this object created (CLAUDE.md: dispose on unload). */
  dispose(scene: THREE.Scene): void {
    scene.remove(this.group);
    scene.background = null;
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
    this.geometries.length = 0;
    this.materials.length = 0;
    this.cubeTexture?.dispose();
    this.cubeTexture = null;
    this.group.clear();
    this.shell = null;
    this.dust = null;
  }
}

/**
 * Deterministic 32-bit PRNG (mulberry32). Seeded so the sky is identical on every
 * run and in every build — the same reason planet generation is seeded.
 */
function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
