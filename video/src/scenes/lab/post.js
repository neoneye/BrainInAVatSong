// post.js: the lab scene's own HDR pipeline: render to a float target, bloom, the nurse's shadow, tone-map into the engine's target.
import * as THREE from 'three';

const VS = `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

export class LabPost {
  constructor(W, H) {
    const rt = (w, h, o = {}) => new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, ...o });
    this.rtScene = rt(W, H, { samples: 4, depthBuffer: true });
    this.h = rt(W / 2, H / 2); this.a1 = rt(W / 4, H / 4); this.a2 = rt(W / 4, H / 4); this.b1 = rt(W / 8, H / 8); this.b2 = rt(W / 8, H / 8); this.c1 = rt(W / 16, H / 16); this.c2 = rt(W / 16, H / 16);
    const mat = (fs, uniforms) => new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: fs, uniforms, depthTest: false, depthWrite: false });
    this.down = mat(`varying vec2 vUv; uniform sampler2D tex; uniform vec2 px; uniform float thr;
      void main() { vec3 c = 0.25 * (texture2D(tex, vUv + px * vec2(-0.5, -0.5)).rgb + texture2D(tex, vUv + px * vec2(0.5, -0.5)).rgb + texture2D(tex, vUv + px * vec2(-0.5, 0.5)).rgb + texture2D(tex, vUv + px * vec2(0.5, 0.5)).rgb);
        float l = max(c.r, max(c.g, c.b)); c *= thr > 0.0 ? smoothstep(thr * 0.6, thr * 1.6, l) : 1.0; gl_FragColor = vec4(min(c, vec3(30.0)), 1.0); }`,
      { tex: { value: null }, px: { value: new THREE.Vector2() }, thr: { value: 0 } });
    this.blur = mat(`varying vec2 vUv; uniform sampler2D tex; uniform vec2 dir;
      void main() { vec3 c = texture2D(tex, vUv).rgb * 0.227027;
        c += (texture2D(tex, vUv + dir * 1.3846).rgb + texture2D(tex, vUv - dir * 1.3846).rgb) * 0.316216;
        c += (texture2D(tex, vUv + dir * 3.2308).rgb + texture2D(tex, vUv - dir * 3.2308).rgb) * 0.070270;
        gl_FragColor = vec4(c, 1.0); }`, { tex: { value: null }, dir: { value: new THREE.Vector2() } });
    this.U = {
      tScene: { value: this.rtScene.texture }, tB1: { value: this.a1.texture }, tB2: { value: this.b1.texture }, tB3: { value: this.c1.texture }, tNurse: { value: null }, tHand: { value: null },
      uExp: { value: 1 }, uBloom: { value: 1 }, uWhite: { value: 0 }, uFade: { value: 1 }, uTint: { value: new THREE.Color(1, 1, 1) }, uTime: { value: 0 },
      uSh: { value: new THREE.Vector4(0, 0, 0, 0) }, uHand: { value: new THREE.Vector4(0, 0, 1, 0) },
    };
    this.comp = mat(`varying vec2 vUv; uniform sampler2D tScene, tB1, tB2, tB3, tNurse, tHand; uniform float uExp, uBloom, uWhite, uFade, uTime; uniform vec3 uTint; uniform vec4 uSh, uHand;
      vec3 aces(vec3 x) { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
      void main() { vec3 c = texture2D(tScene, vUv).rgb;
        vec3 b = texture2D(tB1, vUv).rgb * 0.22 + texture2D(tB2, vUv).rgb * 0.26 + texture2D(tB3, vUv).rgb * 0.14;
        float m = 0.0;
        if (uSh.w > 0.0) { // the nurse: a tall skewed shadow that only darkens what the room light lit, not the glowing fluid
          vec2 q = vec2((vUv.x - uSh.x - uSh.z * (vUv.y - 0.5) + 0.012 * sin(vUv.y * 17.0 + uTime * 1.1)) / (0.5625 * uSh.y) + 0.5, (vUv.y - 1.0) / uSh.y + 1.0);
          if (q.x > 0.0 && q.x < 1.0 && q.y > 0.0) m = texture2D(tNurse, q).r * uSh.w;
        }
        if (uHand.w > 0.0) { vec2 q = (vUv - uHand.xy) / (uHand.z * vec2(0.5625, 1.0)) + 0.5;
          if (q.x > 0.0 && q.x < 1.0 && q.y > 0.0 && q.y < 1.0) m = max(m, texture2D(tHand, q).r * uHand.w); }
        float lum = dot(c, vec3(0.3, 0.6, 0.1));
        c *= 1.0 - m * (1.0 - 0.85 * smoothstep(0.3, 1.5, lum)) * 0.94; b *= 1.0 - m * 0.5;
        c = (c + b * uBloom) * uExp * uTint;
        c = aces(c); c = mix(c, vec3(0.93, 1.0, 0.95), uWhite);
        c = pow(c, vec3(1.0 / 2.2)); c = mix(c, c * c * (3.0 - 2.0 * c), 0.65) * uFade;
        gl_FragColor = vec4(c, 1.0); }`, this.U);
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.comp); this.quad.frustumCulled = false;
    this.qs = new THREE.Scene(); this.qs.add(this.quad); this.qc = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }
  pass(r, m, target) { this.quad.material = m; r.setRenderTarget(target); r.render(this.qs, this.qc); }
  render(r, scene, camera, target) {
    r.setRenderTarget(this.rtScene); r.setClearColor(0x000000, 1); r.clear(); r.render(scene, camera);
    const d = this.down.uniforms, bl = this.blur.uniforms;
    const dn = (src, dst, thr) => { d.tex.value = src.texture; d.px.value.set(1 / src.width, 1 / src.height); d.thr.value = thr; this.pass(r, this.down, dst); };
    const bb = (x, y) => { bl.tex.value = x.texture; bl.dir.value.set(1 / x.width, 0); this.pass(r, this.blur, y); bl.tex.value = y.texture; bl.dir.value.set(0, 1 / x.height); this.pass(r, this.blur, x); };
    dn(this.rtScene, this.h, 1.0); dn(this.h, this.a1, 0); bb(this.a1, this.a2);
    dn(this.a1, this.b1, 0); bb(this.b1, this.b2); dn(this.b1, this.c1, 0); bb(this.c1, this.c2);
    this.pass(r, this.comp, target);
  }
}
