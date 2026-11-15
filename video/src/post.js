// post.js: the final full-screen pass. Cross-fades two scene renders (A = outgoing, B = incoming), grades them for the
// dark-lab look (vignette, grain, chromatic fringing, fluorescent flicker), adds glitch effects, then lays the subtitle
// overlay on top.
import * as THREE from 'three';

const VS = `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const FS = `
precision highp float;
varying vec2 vUv;
uniform sampler2D tA, tB, tOver;
uniform vec2 res;
uniform float mixAB;             // 0 = all A, 1 = all B
uniform float flash, glitch, seed, overOn, time;
uniform float vignette, grain, fringe, flicker, sat, dark;
uniform vec3 tint, flashCol;

float hash(float n) { return fract(sin(n * 127.1 + seed * 31.7) * 43758.5453); }
float hash2(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233)) + seed * 3.17) * 43758.5453); }

vec3 scene(vec2 uv) {
  vec3 a = texture2D(tA, uv).rgb, b = texture2D(tB, uv).rgb;
  return mix(a, b, smoothstep(0.0, 1.0, mixAB));
}

void main() {
  vec2 uv = vUv;
  if (glitch > 0.0) {  // horizontal band tearing
    float band = floor(uv.y * res.y / 22.0), r = hash(band);
    if (r < glitch) uv.x += (hash(band + 7.0) - 0.5) * 0.14 * glitch;
  }
  vec2 d = uv - 0.5;
  float f = fringe * (0.3 + dot(d, d) * 2.4) + glitch * 0.006;
  vec3 col = vec3(scene(uv + d * f).r, scene(uv).g, scene(uv - d * f).b);
  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(vec3(l), col, sat) * tint;
  col *= 1.0 - flicker;
  col *= 1.0 - vignette * smoothstep(0.25, 0.95, length(d * vec2(1.0, 0.82)) * 1.25);
  col += (hash2(floor(vUv * res / 2.0)) - 0.5) * grain * (0.6 + 0.4 * (1.0 - l));
  col = mix(col, flashCol, flash);
  col *= 1.0 - dark;
  if (overOn > 0.5) {
    vec4 o = texture2D(tOver, vUv);
    col = mix(col, o.rgb, o.a);
  }
  gl_FragColor = vec4(col, 1.0);
}`;

export class Post {
  constructor(renderer, W, H, overlayCanvas) {
    this.renderer = renderer;
    this.over = new THREE.CanvasTexture(overlayCanvas);
    this.over.minFilter = this.over.magFilter = THREE.LinearFilter;
    this.over.colorSpace = THREE.NoColorSpace;
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VS, fragmentShader: FS, depthTest: false, depthWrite: false,
      uniforms: {
        tA: { value: null }, tB: { value: null }, tOver: { value: this.over }, res: { value: new THREE.Vector2(W, H) },
        mixAB: { value: 0 }, flash: { value: 0 }, glitch: { value: 0 }, seed: { value: 0 }, overOn: { value: 1 }, time: { value: 0 },
        vignette: { value: 0.55 }, grain: { value: 0.07 }, fringe: { value: 0.004 }, flicker: { value: 0 }, sat: { value: 1 }, dark: { value: 0 },
        tint: { value: new THREE.Color(1, 1, 1) }, flashCol: { value: new THREE.Color(1, 1, 1) },
      },
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat);
    this.quad.frustumCulled = false;
    this.scene = new THREE.Scene(); this.scene.add(this.quad);
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }
  render(u) {
    const U = this.mat.uniforms;
    for (const k in u) {
      if (U[k] === undefined || u[k] === undefined) continue;
      if (U[k].value && U[k].value.set && Array.isArray(u[k])) U[k].value.set(...u[k]);
      else U[k].value = u[k];
    }
    this.over.needsUpdate = true;
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.scene, this.cam);
  }
}
