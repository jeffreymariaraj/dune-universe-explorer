// Unit I: texture and model assets feeding the pipeline.
//
// Thin wrapper over three's loaders that (a) reports progress to the Boot screen
// through the EventBus, (b) never throws on a missing file — callers get null and
// fall back to procedural geometry so the app always runs, and (c) remembers what
// it created so a scene can dispose everything on unload.

import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import type { EventBus } from './EventBus';

export class AssetLoader {
  private readonly manager = new THREE.LoadingManager();
  private readonly gltfLoader: GLTFLoader;
  private readonly textureLoader: THREE.TextureLoader;
  private readonly cubeLoader: THREE.CubeTextureLoader;
  private readonly tracked = new Set<THREE.Texture>();

  constructor(private readonly bus: EventBus) {
    this.manager.onProgress = (url, loaded, total): void => {
      this.bus.emit('assets:progress', { url, loaded, total });
    };
    this.gltfLoader = new GLTFLoader(this.manager);
    this.textureLoader = new THREE.TextureLoader(this.manager);
    this.cubeLoader = new THREE.CubeTextureLoader(this.manager);
  }

  /**
   * HEAD the URL and confirm the server really has the file. Vite's dev server
   * can answer a missing path with the HTML shell, which would otherwise reach
   * the image decoder as a confusing error. Probing keeps the fallback clean.
   */
  async exists(url: string, expect: 'image' | 'model' | 'any' = 'any'): Promise<boolean> {
    try {
      const response = await fetch(url, { method: 'HEAD' });
      if (!response.ok) return false;
      const type = response.headers.get('content-type') ?? '';
      if (type.includes('text/html')) return false; // dev-server fallback page
      if (expect === 'image') return type.startsWith('image/') || type === '';
      return true;
    } catch {
      return false;
    }
  }

  /** Returns null if the model is absent or unreadable. */
  async loadGLTF(url: string): Promise<GLTF | null> {
    if (!(await this.exists(url, 'model'))) {
      this.bus.emit('assets:error', { url, reason: 'not found' });
      return null;
    }
    try {
      return await this.gltfLoader.loadAsync(url);
    } catch (error) {
      this.bus.emit('assets:error', { url, reason: describe(error) });
      return null;
    }
  }

  /** Returns null if any of the six faces is missing. */
  async loadCubeTexture(basePath: string, faces: readonly string[]): Promise<THREE.CubeTexture | null> {
    const urls = faces.map((face) => `${basePath}${face}`);
    const present = await Promise.all(urls.map((url) => this.exists(url, 'image')));
    if (present.some((ok) => !ok)) {
      const missing = urls.filter((_, i) => !present[i]);
      this.bus.emit('assets:error', { url: missing.join(', '), reason: 'cubemap face missing' });
      return null;
    }
    try {
      const texture = await this.cubeLoader.loadAsync(urls);
      texture.colorSpace = THREE.SRGBColorSpace;
      this.tracked.add(texture);
      return texture;
    } catch (error) {
      this.bus.emit('assets:error', { url: basePath, reason: describe(error) });
      return null;
    }
  }

  async loadTexture(url: string): Promise<THREE.Texture | null> {
    if (!(await this.exists(url, 'image'))) {
      this.bus.emit('assets:error', { url, reason: 'not found' });
      return null;
    }
    try {
      const texture = await this.textureLoader.loadAsync(url);
      texture.colorSpace = THREE.SRGBColorSpace;
      this.tracked.add(texture);
      return texture;
    } catch (error) {
      this.bus.emit('assets:error', { url, reason: describe(error) });
      return null;
    }
  }

  /** Dispose every texture this loader created. */
  dispose(): void {
    for (const texture of this.tracked) texture.dispose();
    this.tracked.clear();
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
