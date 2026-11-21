// Day 6. Unit I: fragment stage. Gravitational lensing as a screen-space effect.
//
// A pmndrs/postprocessing Effect wrapping lensing.frag.glsl. Each frame,
// setLens() projects the black hole's world position to the screen and turns
// its physical size into angles:
//
//   Einstein radius   thetaE = sqrt(2 Rs / D)          (radians)
//   photon sphere     theta  = asin(1.5 Rs / D)
//
// and converts those angles to fractions of the screen height through the
// camera's vertical field of view (tan(theta) / (2 tan(fov / 2))). The shader
// then bends every pixel's sample position by thetaE^2 / b — but only pixels
// whose depth puts them behind the hole.
//
// Written for this project from the textbook formulas; the lensing write-up in
// guruprasadregar1-afk/blackhole-physics (MIT) was read as a reference, no code
// copied (see ASSETS_AND_CREDITS.md).

import { Effect, EffectAttribute } from 'postprocessing';
import * as THREE from 'three';
import lensingFragment from '../shaders/lensing.frag.glsl';

export class LensingEffect extends Effect {
  /** Multiplies the physical Einstein radius; 1 is "physical", raise for drama. */
  strength = 1;

  private readonly projected = new THREE.Vector3();
  private readonly toHole = new THREE.Vector3();
  private readonly cameraForward = new THREE.Vector3();

  constructor() {
    super('LensingEffect', lensingFragment, {
      // Ask the composer for the depth buffer: foreground pixels are not bent.
      attributes: EffectAttribute.DEPTH,
      uniforms: new Map<string, THREE.Uniform>([
        ['uCenter', new THREE.Uniform(new THREE.Vector2(0.5, 0.5))],
        ['uEinstein', new THREE.Uniform(0)],
        ['uShadow', new THREE.Uniform(0)],
        ['uAspect', new THREE.Uniform(1)],
        ['uActive', new THREE.Uniform(0)],
        ['uHoleDepth', new THREE.Uniform(0)],
      ]),
    });
  }

  /** Call once per rendered frame, after the camera has moved. */
  /**
   * @param systemRadius How far the hole's own visuals reach (its disk). Pixels
   *                     nearer than (hole distance - systemRadius) are foreground.
   */
  setLens(
    holePosition: THREE.Vector3,
    schwarzschildRadius: number,
    systemRadius: number,
    camera: THREE.PerspectiveCamera,
  ): void {
    const u = this.uniforms;
    this.toHole.subVectors(holePosition, camera.position);
    const distance = this.toHole.length();
    camera.getWorldDirection(this.cameraForward);

    // Behind the camera (or inside the hole): nothing to bend on screen.
    if (distance < schwarzschildRadius * 1.6 || this.toHole.dot(this.cameraForward) <= 0) {
      u.get('uActive')!.value = 0;
      return;
    }

    // World -> normalised device coordinates -> uv (Unit IV: projection).
    this.projected.copy(holePosition).project(camera);
    (u.get('uCenter')!.value as THREE.Vector2).set(this.projected.x * 0.5 + 0.5, this.projected.y * 0.5 + 0.5);

    const toScreen = 1 / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
    const einstein = Math.sqrt((2 * schwarzschildRadius) / distance) * Math.sqrt(this.strength);
    const shadow = Math.asin(Math.min(1, (1.5 * schwarzschildRadius) / distance));
    u.get('uEinstein')!.value = Math.tan(Math.min(einstein, 1.2)) * toScreen;
    u.get('uShadow')!.value = Math.tan(shadow) * toScreen;
    u.get('uAspect')!.value = camera.aspect;
    u.get('uHoleDepth')!.value = this.toHole.dot(this.cameraForward) - systemRadius;
    u.get('uActive')!.value = 1;
  }

  /** True when the last setLens() found the hole in front of the camera. */
  get isActive(): boolean {
    return this.uniforms.get('uActive')!.value === 1;
  }

  /** Turn the bend off (no anomaly in this scene). */
  deactivate(): void {
    this.uniforms.get('uActive')!.value = 0;
  }
}
