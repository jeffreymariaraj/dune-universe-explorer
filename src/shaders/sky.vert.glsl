// Unit IV: a sky dome that rides with the camera (like the space skybox), so
// it always surrounds the viewer and is never reached.

varying vec3 vDirection;

void main() {
  vDirection = normalize(position);
  vec4 world = modelMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * viewMatrix * world;
}
