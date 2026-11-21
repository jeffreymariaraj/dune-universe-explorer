// Unit V: particle systems. Unit IV: perspective size attenuation.
//
// The CPU writes each particle ONCE, when it is born: start position, velocity,
// birth time, lifetime. From then on this shader alone moves it:
//   position(t) = start + velocity * age,   age = uTime - birth
// and grows, cools and fades it with age. That is why a thousand particles cost
// almost nothing on the CPU.

attribute vec3 aVelocity;
attribute float aBirth;
attribute float aLife;
attribute float aSize;

uniform float uTime;
uniform float uViewportHeight;   // drawing-buffer pixels

varying float vAge01;            // 0 at birth, 1 at death
varying float vNearFade;         // 0 right at the camera lens, 1 further out

void main() {
  float age = uTime - aBirth;
  vAge01 = age / aLife;
  if (vAge01 < 0.0 || vAge01 > 1.0) {
    // Dead (or not yet born): collapse to nothing, outside the clip volume.
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    return;
  }

  vec3 world = position + aVelocity * age;
  vec4 view = viewMatrix * vec4(world, 1.0);
  gl_Position = projectionMatrix * view;

  // World-size sprites: pixels = size * focal length / depth.
  float size = aSize * (0.6 + 1.2 * vAge01);   // puffs expand as they cool
  float depth = max(-view.z, 0.001);
  gl_PointSize = min(size * projectionMatrix[1][1] * 0.5 * uViewportHeight / depth, 96.0);

  // Puffs that drift right up to the chase camera would fill the screen with
  // white; fade them out over the last few units instead.
  vNearFade = smoothstep(4.0, 20.0, depth);
}
