// Unit IV: model -> world -> view -> clip for the accretion disk ring.
// The ring lies in its local XZ plane; the local position gives radius and
// angle, the world position gives the view direction for Doppler beaming.

varying vec3 vLocal;
varying vec3 vWorld;
varying vec3 vVelocityDir;   // world-space direction the gas is moving here

void main() {
  vLocal = position;
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  // Prograde (counter-clockwise from +Y): at (x, 0, z) the gas moves along
  // (z, 0, -x) / r — the same sense as the planets' orbits.
  vec3 tangent = normalize(vec3(position.z, 0.0, -position.x) + vec3(1e-5));
  vVelocityDir = normalize(mat3(modelMatrix) * tangent);
  gl_Position = projectionMatrix * viewMatrix * world;
}
