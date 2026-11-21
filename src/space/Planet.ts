// Day 3. Unit I: primitives and attributes. Unit V: object shape and appearance.
// Unit IV: visible-surface work saved by level of detail.
//
// Cube-sphere planet: the shared unit cube-sphere geometries (CubeSphere.ts),
// displaced by FBM simplex noise in the vertex shader, coloured by a per-biome
// height ramp, lit by the day/night shader. Three THREE.LOD levels keep the
// triangle count and draw-call budget in check: only a planet you are close to
// pays for its top level.
//
// The GPU noise (planetHeight.glsl) and the CPU noise (physics/noise.ts) are
// the same function with the same seed offset, sea level and parameters, so
// surfaceRadius() on the CPU returns the rendered ground height (CLAUDE.md).
//
// Approach (cube-sphere + vertex-shader FBM + biome ramp) follows the ideas in
// dgreenheck/threejs-procedural-planets and EepyBerry/lagrange; no code was
// copied from either. Simplex noise is adapted from stegu/webgl-noise (MIT).

import * as THREE from 'three';
import type { PlanetData } from '../data/systemData';
import { seedOffset, surfaceRadius, type HeightParams } from '../physics/noise';
import planetVertex from '../shaders/planet.vert.glsl';
import planetFragment from '../shaders/planet.frag.glsl';
import { biomeFor, type Biome } from '../surface/Biomes';
import { Atmosphere } from './Atmosphere';

export interface PlanetShading {
  /** Width of the soft terminator, in units of N.L. */
  terminatorWidth: number;
  /** Night-side brightness floor. */
  ambient: number;
}

export const DEFAULT_PLANET_SHADING: PlanetShading = {
  terminatorWidth: 0.12,
  ambient: 0.025,
};

/**
 * LOD switch distances, in planet radii from the planet centre. Level 0 (top)
 * from 0, level 1 beyond the first, level 2 beyond the second.
 */
export const LOD_DISTANCES_IN_RADII = [0, 7, 28] as const;

/** Sea level sent to the shader when a biome has no sea (below any height). */
const NO_SEA = -2;

export class Planet {
  /** Lives under the spin node: turns with the planet. */
  readonly lod = new THREE.LOD();
  /** Lives under the orbit pivot: does not need to spin. */
  readonly atmosphere: Atmosphere;
  readonly radius: number;
  readonly biome: Biome;
  /** What collision and landing must use to find the ground (Day 4/7/8). */
  readonly heightParams: HeightParams;

  private readonly material: THREE.ShaderMaterial;
  private readonly meshes: THREE.Mesh[] = [];

  /**
   * @param levels Shared unit cube-sphere geometries, highest detail first.
   *               Owned by the caller (SolarSystem), which disposes them and
   *               sets their bounding sphere to cover the tallest mountains.
   */
  constructor(
    readonly data: PlanetData,
    levels: readonly THREE.BufferGeometry[],
    starColor: THREE.Color,
    shading: PlanetShading = DEFAULT_PLANET_SHADING,
  ) {
    this.radius = data.physical.radius;
    const gen = data.generation;
    this.biome = biomeFor(gen.biome);

    this.heightParams = Planet.heightParamsFor(data);

    const palette = gen.palette.map((hex) => new THREE.Color(hex));
    const water = this.biome.water;

    this.material = new THREE.ShaderMaterial({
      vertexShader: planetVertex,
      fragmentShader: planetFragment,
      uniforms: {
        // --- shape: must match heightParams exactly (CPU/GPU parity) ---
        uFrequency: { value: this.heightParams.frequency },
        uOctaves: { value: Math.round(this.heightParams.octaves) },
        uRidged: { value: this.heightParams.ridged ? 1 : 0 },
        uSeedOffset: { value: new THREE.Vector3(...this.heightParams.offset) },
        uSeaLevel: { value: this.heightParams.seaLevel ?? NO_SEA },
        uAmplitude: { value: this.heightParams.amplitude },
        // About one top-LOD vertex spacing: smaller picks up sub-vertex noise
        // and the shading turns to glitter on ridged worlds.
        uNormalEpsilon: { value: 0.025 },
        // --- appearance ---
        // THREE.Color converts these sRGB hex strings to linear RGB, which is
        // what the shader works in; colorspace_fragment converts back.
        uPalette: { value: palette },
        uWaterDeep: { value: water ? new THREE.Color(water.deep) : palette[0]!.clone() },
        uWaterShallow: { value: water ? new THREE.Color(water.shallow) : palette[1]!.clone() },
        uLandRampStart: { value: this.biome.landRampStart },
        uPolarCap: { value: this.biome.polarCap },
        uSpecular: { value: this.biome.specular },
        uStarPosition: { value: new THREE.Vector3() },
        uStarColor: { value: starColor.clone() },
        uAtmosphereColor: { value: new THREE.Color(gen.atmosphere.color) },
        uAtmosphereDensity: { value: gen.atmosphere.density },
        uSeed: { value: gen.seed },
        uNightLights: { value: gen.nightLights ? 1 : 0 },
        uTerminatorWidth: { value: shading.terminatorWidth },
        uAmbient: { value: shading.ambient },
      },
    });

    levels.forEach((geometry, level) => {
      const mesh = new THREE.Mesh(geometry, this.material);
      mesh.name = `${data.name}:lod${level}`;
      mesh.scale.setScalar(this.radius);
      this.meshes.push(mesh);
      const distance = LOD_DISTANCES_IN_RADII[Math.min(level, LOD_DISTANCES_IN_RADII.length - 1)] ?? 0;
      this.lod.addLevel(mesh, distance * this.radius);
    });
    this.lod.name = `${data.name}:lod`;

    this.atmosphere = new Atmosphere(this.radius, gen.atmosphere.color, gen.atmosphere.density, gen.noise.amplitude);
    this.atmosphere.mesh.name = `${data.name}:atmosphere`;
  }

  /**
   * The terrain function's parameters for a planet, from planets.json and its
   * biome. Static so physics and tests can get them without building a mesh.
   */
  static heightParamsFor(data: PlanetData): HeightParams {
    const gen = data.generation;
    return {
      frequency: gen.noise.frequency,
      octaves: gen.noise.octaves,
      amplitude: gen.noise.amplitude,
      ridged: gen.noise.ridged,
      offset: seedOffset(gen.seed),
      seaLevel: biomeFor(gen.biome).seaLevel,
    };
  }

  /** Index of the LOD level drawn last frame (0 = most detailed). */
  get currentLevel(): number {
    return this.lod.getCurrentLevel();
  }

  /**
   * Ground distance from the planet centre along a direction in the planet's
   * own (spinning) frame. CPU twin of the vertex shader's displacement.
   */
  surfaceRadiusAt(direction: THREE.Vector3): number {
    const d = direction.clone().normalize();
    return surfaceRadius(d.x, d.y, d.z, this.radius, this.heightParams);
  }

  /** Called per frame with world positions (lighting is world space). */
  updateLighting(planetCenter: THREE.Vector3, starPosition: THREE.Vector3): void {
    this.material.uniforms['uStarPosition']!.value.copy(starPosition);
    this.atmosphere.update(planetCenter, starPosition);
  }

  setShading(shading: PlanetShading): void {
    const uniforms = this.material.uniforms;
    uniforms['uTerminatorWidth']!.value = shading.terminatorWidth;
    uniforms['uAmbient']!.value = shading.ambient;
  }

  set wireframe(value: boolean) {
    this.material.wireframe = value;
  }

  /** Disposes this planet's material and atmosphere. Shared geometries are not ours. */
  dispose(): void {
    this.lod.removeFromParent();
    this.lod.clear();
    this.meshes.length = 0;
    this.material.dispose();
    this.atmosphere.dispose();
  }
}
