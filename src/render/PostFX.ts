// Day 6. Unit I: the end of the graphics pipeline — rendering to off-screen
// buffers and processing the image before it reaches the display.
//
// pmndrs/postprocessing EffectComposer (Zlib licence):
//   RenderPass         the scene into a half-float (HDR) buffer, 2x MSAA
//   EffectPass #1      LensingEffect: bends the image around the black hole
//   EffectPass #2      Bloom (mipmap blur at half resolution, per the
//                      performance budget), vignette, ACES tone mapping
// Lensing gets its own pass because it moves UVs; bloom then blurs the
// already-bent image, so the Einstein ring glows too.
//
// Tone mapping moves from the renderer to the end of the chain: scenes render
// linear HDR (values above 1 survive, which is what bloom feeds on), and only
// the final pass compresses them for the screen. While PostFX is alive the
// renderer's own toneMapping is off; dispose() restores it.
//
// `enabled = false` bypasses everything and draws directly, so a broken pass
// can never block the demo.
//
// Day 7: every state builds its own PostFX with the passes it needs — Space
// with lensing, Warp with chromatic aberration (colour fringes that grow
// towards the screen edge as the "jump" builds), Surface with neither.

import {
  BloomEffect,
  ChromaticAberrationEffect,
  Effect,
  EffectAttribute,
  EffectComposer,
  EffectPass,
  RenderPass,
  ToneMappingEffect,
  ToneMappingMode,
  VignetteEffect,
} from 'postprocessing';
import * as THREE from 'three';
import { LensingEffect } from './LensingEffect';
import depthViewFragment from '../shaders/depthView.frag.glsl';

export interface PostFXOptions {
  /** Gravitational lensing pass (Space). */
  lensing?: boolean;
  /** Chromatic aberration (Warp). */
  aberration?: boolean;
}

export class PostFX {
  /** false = draw straight to the screen with the renderer's own tone mapping. */
  enabled = true;
  /** Present when created with { lensing: true }; otherwise an inactive stand-in. */
  readonly lensing: LensingEffect;
  readonly aberration: ChromaticAberrationEffect | null;
  readonly bloom: BloomEffect;
  readonly vignette: VignetteEffect;

  private readonly composer: EffectComposer;
  /** Day 10 X-Ray: replaces the image with the depth buffer when enabled. */
  private readonly depthPass: EffectPass;
  private readonly finalPass: EffectPass;
  private readonly lensingPass: EffectPass | null = null;
  private readonly savedToneMapping: THREE.ToneMapping;
  private readonly savedExposure: number;

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.PerspectiveCamera,
    options: PostFXOptions = { lensing: true },
  ) {
    this.savedToneMapping = renderer.toneMapping;
    this.savedExposure = renderer.toneMappingExposure;

    this.composer = new EffectComposer(renderer, {
      frameBufferType: THREE.HalfFloatType,
      // Measured at 2048x1536: MSAA x4 ~14 ms/frame, x2 ~9 ms, off ~6 ms.
      // x2 keeps edges clean inside the 60 fps budget; lil-gui can change it.
      multisampling: Math.min(2, renderer.capabilities.maxSamples),
    });
    this.composer.addPass(new RenderPass(scene, camera));

    this.lensing = new LensingEffect();
    if (options.lensing) {
      this.lensingPass = new EffectPass(camera, this.lensing);
      this.composer.addPass(this.lensingPass);
    }

    this.bloom = new BloomEffect({
      intensity: 1.1,
      luminanceThreshold: 0.85,
      luminanceSmoothing: 0.25,
      mipmapBlur: true,
      radius: 0.7,
      resolutionScale: 0.5,
    });
    this.vignette = new VignetteEffect({ offset: 0.32, darkness: 0.55 });
    const toneMapping = new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC });
    this.aberration = options.aberration
      ? new ChromaticAberrationEffect({
          offset: new THREE.Vector2(0, 0),
          radialModulation: true, // fringes grow towards the edges, like a real lens
          modulationOffset: 0.2,
        })
      : null;
    const finalEffects = this.aberration
      ? [this.aberration, this.bloom, this.vignette, toneMapping]
      : [this.bloom, this.vignette, toneMapping];
    this.finalPass = new EffectPass(camera, ...finalEffects);
    this.composer.addPass(this.finalPass);

    // Unit IV: the depth buffer as a picture (X-Ray). Off unless asked for.
    this.depthPass = new EffectPass(
      camera,
      new Effect('DepthViewEffect', depthViewFragment, { attributes: EffectAttribute.DEPTH }),
    );
    this.composer.addPass(this.depthPass);
    this.depthView = false;

    this.applyRendererToneMapping();
  }

  render(deltaSeconds: number): void {
    if (this.enabled) {
      this.applyRendererToneMapping();
      // Day 10 perf pass: skip the whole lensing pass (a full-screen draw with
      // two depth reads per pixel) whenever the hole is not in front of us.
      if (this.lensingPass) this.lensingPass.enabled = this.lensing.isActive;
      this.composer.render(deltaSeconds);
    } else {
      this.renderer.toneMapping = this.savedToneMapping;
      this.renderer.toneMappingExposure = this.savedExposure;
      this.renderer.render(this.scene, this.camera);
    }
  }

  /** Show the depth buffer instead of the image (X-Ray). */
  set depthView(enabled: boolean) {
    // Only the last ENABLED pass may draw to the screen.
    this.depthPass.enabled = enabled;
    this.depthPass.renderToScreen = enabled;
    this.finalPass.renderToScreen = !enabled;
  }

  get depthView(): boolean {
    return this.depthPass.enabled;
  }

  /** Unit IV: draw through another camera, e.g. the orthographic system map. */
  setCamera(camera: THREE.Camera): void {
    for (const pass of this.composer.passes) pass.mainCamera = camera;
  }

  /** Chromatic aberration strength, 0..1 (Warp only). */
  setAberration(amount: number): void {
    this.aberration?.offset.set(0.006 * amount, 0.004 * amount);
  }

  /** Anti-aliasing samples for the scene buffer (0, 2 or 4). */
  get multisampling(): number {
    return this.composer.multisampling;
  }

  set multisampling(samples: number) {
    this.composer.multisampling = Math.min(samples, this.renderer.capabilities.maxSamples);
  }

  setSize(width: number, height: number): void {
    this.composer.setSize(width, height, false);
  }

  dispose(): void {
    this.composer.dispose();
    this.renderer.toneMapping = this.savedToneMapping;
    this.renderer.toneMappingExposure = this.savedExposure;
  }

  private applyRendererToneMapping(): void {
    // The scene must reach the composer as linear HDR; ToneMappingEffect does it at the end.
    this.renderer.toneMapping = THREE.NoToneMapping;
  }
}
