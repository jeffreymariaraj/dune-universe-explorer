// Day 6. Unit V: object shape and appearance; physical modelling (gravity).
//
// "The Silent Maw" from planets.json: an uncharted anomaly, deliberately not
// Dune canon (its lore card says so). Three parts:
//   * photon sphere : a black sphere of radius 1.5 Rs. Nothing that crosses it
//                     comes back, so it is drawn pure black and is where the
//                     ship is lost (SpaceScene treats a contact as fatal)
//   * accretion disk: a ring of hot gas with a shader for temperature,
//                     Keplerian shear and Doppler beaming (accretionDisk.*.glsl)
//   * lensing       : not here — a full-screen pass (render/LensingEffect.ts)
//                     bends the image around this object's screen position
//
// Gravity: in physics the Schwarzschild radius is Rs = 2GM/c^2, so the
// anomaly's mu = GM = Rs c^2 / 2. The game's "speed of light" is 640 u/s, just
// above the ship's top speed, which makes it a strong but survivable well.
//
// Lensing maths: written for this project from the textbook weak-field
// formula, after reading guruprasadregar1-afk/blackhole-physics (MIT) as a
// reference; no code was copied.

import * as THREE from 'three';
import type { BlackHoleData } from '../data/systemData';
import diskVertex from '../shaders/accretionDisk.vert.glsl';
import diskFragment from '../shaders/accretionDisk.frag.glsl';

/** Game-units speed of light, u/s. */
export const GAME_LIGHT_SPEED = 640;
/** Photon-sphere radius in Schwarzschild radii. */
export const PHOTON_SPHERE = 1.5;
/** Tilt of the disk relative to the orbit plane, so it reads as a disk from most angles. */
const DISK_TILT_DEG = 18;

export class BlackHole {
  /** Moved along the anomaly's orbit by SolarSystem (translation only). */
  readonly root = new THREE.Group();
  readonly schwarzschildRadius: number;
  readonly photonSphereRadius: number;
  readonly diskInner: number;
  readonly diskOuter: number;
  /** GM for the gravity field, from Rs = 2GM/c^2. */
  readonly mu: number;

  private readonly horizon: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  private readonly disk: THREE.Mesh<THREE.RingGeometry, THREE.ShaderMaterial>;

  constructor(readonly data: BlackHoleData) {
    this.root.name = data.name;
    const { schwarzschildRadius, diskInner, diskOuter } = data.physical;
    this.schwarzschildRadius = schwarzschildRadius;
    this.photonSphereRadius = schwarzschildRadius * PHOTON_SPHERE;
    this.diskInner = diskInner;
    this.diskOuter = diskOuter;
    this.mu = (schwarzschildRadius * GAME_LIGHT_SPEED * GAME_LIGHT_SPEED) / 2;

    this.horizon = new THREE.Mesh(
      new THREE.SphereGeometry(this.photonSphereRadius, 48, 32),
      new THREE.MeshBasicMaterial({ color: 0x000000 }),
    );
    this.horizon.name = `${data.name}:photonSphere`;
    this.root.add(this.horizon);

    const ring = new THREE.RingGeometry(diskInner, diskOuter, 256, 12);
    ring.rotateX(-Math.PI / 2); // RingGeometry is in XY; the disk lives in XZ
    this.disk = new THREE.Mesh(
      ring,
      new THREE.ShaderMaterial({
        vertexShader: diskVertex,
        fragmentShader: diskFragment,
        uniforms: {
          uTime: { value: 0 },
          uInner: { value: diskInner },
          uOuter: { value: diskOuter },
          uIntensity: { value: 3.2 },
          uBeaming: { value: 0.55 },
        },
        side: THREE.DoubleSide,
        transparent: true,
        depthWrite: false, // glowing gas: never hides what is behind it
        blending: THREE.AdditiveBlending,
      }),
    );
    this.disk.name = `${data.name}:accretionDisk`;
    this.disk.rotation.x = THREE.MathUtils.degToRad(DISK_TILT_DEG);
    this.root.add(this.disk);
  }

  /** Simulation clock for the gas animation. */
  setTime(seconds: number): void {
    this.disk.material.uniforms['uTime']!.value = seconds;
  }

  dispose(): void {
    this.root.removeFromParent();
    this.horizon.geometry.dispose();
    this.horizon.material.dispose();
    this.disk.geometry.dispose();
    this.disk.material.dispose();
    this.root.clear();
  }
}
