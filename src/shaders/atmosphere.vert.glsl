// Unit IV: model-view-projection for the atmosphere shell. Only the world
// position is needed: the fragment shader works out the view ray itself.

varying vec3 vWorldPosition;

void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorldPosition = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
