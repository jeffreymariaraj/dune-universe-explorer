// Day 2. Unit V: visual appearance. Unit I: colour and blending.
//
// Canopus, the root of the system's scene graph. Three parts:
//   * photosphere : a sphere with a self-lit shader (limb darkening, granulation)
//   * corona      : a camera-facing sprite, additively blended, so the star
//                   glows past its own edge before Day 6 adds real bloom
//   * light       : a PointLight with no distance falloff that lights every
//                   standard-material object (the ship). Planets use their own
//                   day/night shader and read the star's position directly.
//
// Data comes only from the `star` entry in planets.json (CLAUDE.md).

import * as THREE from 'three';
import type { StarData } from '../data/systemData';
import starVertex from '../shaders/star.vert.glsl';
import starFragment from '../shaders/star.frag.glsl';

export class Star {
  /** Position frame of the star. Orbit pivots of its planets are children of this. */
  readonly frame = new THREE.Group();
  readonly color: THREE.Color;
  readonly radius: number;
  readonly light: THREE.PointLight;

  private readonly photosphere: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  private readonly corona: THREE.Sprite;
  private readonly coronaTexture: THREE.CanvasTexture;

  constructor(readonly data: StarData) {
    this.frame.name = data.name;
    this.radius = data.physical.radius;
    this.color = new THREE.Color(data.physical.color);

    const material = new THREE.ShaderMaterial({
      vertexShader: starVertex,
      fragmentShader: starFragment,
      uniforms: {
        uColor: { value: this.color.clone() },
        uTime: { value: 0 },
        uIntensity: { value: 1.4 },
      },
    });
    this.photosphere = new THREE.Mesh(new THREE.SphereGeometry(this.radius, 64, 32), material);
    this.photosphere.name = `${data.name}:photosphere`;
    this.frame.add(this.photosphere);

    this.coronaTexture = buildCoronaTexture(this.color);
    this.corona = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: this.coronaTexture,
        color: 0xffffff,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false, // never hides the stars or planets behind it
      }),
    );
    this.corona.name = `${data.name}:corona`;
    this.corona.scale.setScalar(this.radius * 7);
    this.frame.add(this.corona);

    // decay = 0: no inverse-square falloff. Real falloff over 18,000 units would
    // leave the outer planets' ships in the dark (SYSTEM_DESIGN.md non-goals:
    // not real astrophysical scale).
    this.light = new THREE.PointLight(this.color, 2.6, 0, 0);
    this.light.name = `${data.name}:light`;
    this.frame.add(this.light);
  }

  /** Fixed-step animation clock for the granulation. */
  setTime(seconds: number): void {
    this.photosphere.material.uniforms['uTime']!.value = seconds;
  }

  dispose(): void {
    this.frame.removeFromParent();
    this.photosphere.geometry.dispose();
    this.photosphere.material.dispose();
    this.corona.material.dispose();
    this.coronaTexture.dispose();
    this.light.dispose();
    this.frame.clear();
  }
}

/** A soft radial gradient, drawn once on a canvas. No image file needed. */
function buildCoronaTexture(color: THREE.Color): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (context) {
    const half = size / 2;
    const gradient = context.createRadialGradient(half, half, 0, half, half, half);
    const css = `#${color.getHexString()}`;
    // The sprite spans 7 star radii, so the photosphere's edge sits at ~0.29
    // of the gradient radius. Everything inside that is hidden by the sphere.
    gradient.addColorStop(0.0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.28, 'rgba(255,255,255,0.85)');
    gradient.addColorStop(0.33, css);
    gradient.addColorStop(0.5, 'rgba(255,170,90,0.22)');
    gradient.addColorStop(0.75, 'rgba(255,140,60,0.06)');
    gradient.addColorStop(1.0, 'rgba(0,0,0,0)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, size, size);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
