// Day 3. Unit V: visual appearance. Unit I: blending.
//
// A sphere slightly larger than the planet, rendered with back faces only and
// additive blending. atmosphere.frag.glsl finds each view ray's closest
// approach to the planet centre and glows most just above the surface, so the
// limb lights up and a backlit planet gets a bright ring. Colour and density
// come from generation.atmosphere in planets.json.
//
// Parented to the orbit pivot, not the spin node: air does not need to rotate,
// and it saves recomputing nothing — the shell is a plain sphere.

import * as THREE from 'three';
import atmosphereVertex from '../shaders/atmosphere.vert.glsl';
import atmosphereFragment from '../shaders/atmosphere.frag.glsl';

export class Atmosphere {
  readonly mesh: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  readonly outerRadius: number;

  constructor(planetRadius: number, color: THREE.ColorRepresentation, density: number, peakTerrain: number) {
    // Shell thickness grows with density; it must clear the highest mountain.
    this.outerRadius = planetRadius * (1 + peakTerrain + 0.07 + 0.05 * density);

    const material = new THREE.ShaderMaterial({
      vertexShader: atmosphereVertex,
      fragmentShader: atmosphereFragment,
      uniforms: {
        uPlanetCenter: { value: new THREE.Vector3() },
        // Glow starts a little below the mean surface so valleys get some too.
        uPlanetRadius: { value: planetRadius * (1 - peakTerrain * 0.5) },
        uAtmosphereRadius: { value: this.outerRadius },
        uStarPosition: { value: new THREE.Vector3() },
        uColor: { value: new THREE.Color(color) },
        uDensity: { value: density },
      },
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(this.outerRadius, 64, 48), material);
    this.mesh.name = 'atmosphere';
  }

  /** Per frame, after the scene graph's world matrices are up to date. */
  update(planetCenter: THREE.Vector3, starPosition: THREE.Vector3): void {
    const uniforms = this.mesh.material.uniforms;
    uniforms['uPlanetCenter']!.value.copy(planetCenter);
    uniforms['uStarPosition']!.value.copy(starPosition);
  }

  set visible(value: boolean) {
    this.mesh.visible = value;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
