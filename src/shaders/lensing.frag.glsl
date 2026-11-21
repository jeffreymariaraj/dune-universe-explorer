// Unit I: the fragment stage as a full-screen image operation.
// Unit V: physical modelling — gravitational lensing by a point mass.
//
// Thin-lens, point-mass lensing in screen space. For a pixel at angular
// distance b (the impact parameter) from the black hole's image, the light we
// see there really came from a source at
//
//   beta = b - thetaE^2 / b,     thetaE^2 = 2 Rs / D     (Einstein radius)
//
// (the weak-field deflection alpha = 2 Rs / b, i.e. 4GM / (c^2 b), scaled by
// distance). So we sample the frame at beta instead of b: one texture fetch.
//   b = thetaE   -> beta = 0: the point right behind the hole, smeared into a
//                   ring (the Einstein ring)
//   b < thetaE   -> beta < 0: the source from the OPPOSITE side (second image)
// Inside the photon sphere's image there is no deflection, so the geometry
// there (the black sphere and the disk in front of it) is left untouched.
//
// Angles are in "screen heights" (uv.y units), so x is scaled by the aspect.
//
// Unit IV: visible-surface information. Only light from behind the hole (or
// its own disk) can be bent by it, so the depth buffer decides: a pixel nearer than the hole (the
// ship, its trail, a planet in front) is left alone, and a bent sample that
// lands on such a foreground pixel is rejected, so the ship never appears as a
// ghost image inside the ring.

uniform vec2 uCenter;       // black hole's screen position, uv
uniform float uEinstein;    // Einstein radius, screen heights
uniform float uShadow;      // photon-sphere image radius, screen heights
uniform float uAspect;      // width / height
uniform float uActive;      // 0 when the hole is behind the camera
uniform float uHoleDepth;   // view-axis distance to the FRONT of the hole's disk:
                            // anything nearer than this is foreground

/** Distance along the view axis of whatever was drawn at this uv. */
float sceneDepth(const in vec2 uv) {
  return -getViewZ(readDepth(uv));
}

void mainUv(inout vec2 uv) {
  if (uActive < 0.5) return;
  if (sceneDepth(uv) < uHoleDepth) return; // foreground: not lensed
  vec2 d = uv - uCenter;
  d.x *= uAspect;
  float b = length(d);
  if (b < 1e-6) return;

  float deflection = uEinstein * uEinstein / b;
  // Fade the bend in just outside the shadow: no tearing at its rim.
  deflection *= smoothstep(uShadow, uShadow * 1.35, b);

  vec2 offset = (d / b) * deflection;
  offset.x /= uAspect;
  vec2 bent = uv - offset;
  if (sceneDepth(bent) < uHoleDepth) return; // would show a foreground object
  uv = bent;
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  outputColor = inputColor;
}
