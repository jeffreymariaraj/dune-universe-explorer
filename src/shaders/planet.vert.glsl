// Unit IV: the viewing pipeline, written out — model -> world -> view -> clip.
// Unit V: object shape (procedural displacement) and object hierarchies.
//
// Every vertex of the shared unit cube-sphere is pushed out along its direction
// by the planet's FBM height (planetHeight.glsl — the same function physics
// uses on the CPU). The mesh is scaled by the planet radius in its modelMatrix,
// which is the product of star -> orbitPivot -> tilt -> spin -> mesh, so the
// terrain turns with the spin node while lighting stays in world space.
//
// The normal must be recomputed after displacement: the height at two nearby
// directions along a tangent frame gives two edge vectors, and their cross
// product is the displaced surface normal (finite differences).

#include ./planetHeight.glsl

uniform float uAmplitude;      // peak displacement, fraction of radius
uniform float uNormalEpsilon;  // tangent step on the unit sphere

varying vec3 vObjectDir;       // undisplaced direction: rotates with the planet
varying vec3 vWorldNormal;
varying vec3 vWorldPosition;
varying float vHeight;         // after the sea clamp
varying float vRawHeight;      // before it (water depth)

vec3 displace(vec3 dir) {
  return dir * (1.0 + uAmplitude * planetHeight(dir));
}

void main() {
  vec3 dir = normalize(position);
  float raw = rawHeight(dir);
  float height = max(raw, uSeaLevel);
  vec3 surface = dir * (1.0 + uAmplitude * height);

  // Tangent frame on the sphere. cross(t1, t2) == dir, so the result points out.
  vec3 helper = abs(dir.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
  vec3 t1 = normalize(cross(helper, dir));
  vec3 t2 = cross(dir, t1);
  vec3 pa = displace(normalize(dir + t1 * uNormalEpsilon));
  vec3 pb = displace(normalize(dir + t2 * uNormalEpsilon));
  vec3 objectNormal = normalize(cross(pa - surface, pb - surface));

  vObjectDir = dir;
  vHeight = height;
  vRawHeight = raw;

  vec4 world = modelMatrix * vec4(surface, 1.0);
  vWorldPosition = world.xyz;
  // mat3(modelMatrix) is a valid normal matrix: every node in the chain has
  // uniform scale (rotations, translations and the radius scale only).
  vWorldNormal = normalize(mat3(modelMatrix) * objectNormal);

  gl_Position = projectionMatrix * viewMatrix * world;
}
