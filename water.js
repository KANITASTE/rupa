/* RUPA — quiet water surface. WebGL ripple layer as a <rupa-water> web component. */

const WATER_CONFIG = {
  idleMotionStrength: 0.55,     // 常時ゆらぎの振幅(0で停止)
  idleMotionSpeed: 0.35,        // 常時ゆらぎの速さ
  slowSpeedThreshold: 350,      // px/s 未満 = ゆっくり
  fastSpeedThreshold: 1300,     // px/s 以上 = 速い
  maxRippleCount: 16,           // 同時波紋の上限
  rippleLifetime: 4.5,          // 波紋の寿命(秒)
  rippleExpansionSpeed: 110,    // 波紋の広がる速さ(px/s)
  rippleAmplitude: 5.0,         // 波紋の高さ(リアルさ/存在感)
  rippleRefractionStrength: 1.0,// 背景の屈折の強さ
  rippleHighlightStrength: 1.0, // 波の山のハイライト強さ
  rippleSpawnCooldown: 0.10,    // 波紋発生の最短間隔(秒)
  directionalBiasHorizontal: 0.6,// 横移動で連続波紋が出やすい度合い(0-1)
  mobileQualityScale: 0.72      // モバイルでの解像度スケール
};

const VERT = `
attribute vec2 a;
void main(){ gl_Position = vec4(a, 0.0, 1.0); }
`;

const FRAG = `
precision highp float;
const int MAXR = 16;
uniform vec2 u_res;
uniform float u_time;
uniform vec4 u_rip[MAXR];   // x, y, birth, amp
uniform float u_seed[MAXR];
uniform int u_count;
uniform float u_idle;
uniform float u_idleSpeed;
uniform float u_refr;
uniform float u_hl;
uniform float u_speed;      // expansion speed
uniform float u_life;

float ripH(vec2 p, vec4 rp, float seed){
  float age = u_time - rp.z;
  if (age < 0.0 || age > u_life) return 0.0;
  vec2 dv = p - rp.xy;
  float d = length(dv);
  float ang = atan(dv.y, dv.x);
  // slight organic wobble so rings are not machine-perfect circles
  d *= 1.0 + 0.018*sin(ang*5.0 + seed*6.2831) + 0.011*sin(ang*3.0 - seed*4.1);
  float radius = u_speed * pow(age, 0.88);
  float w = 16.0 + age*26.0;
  float x = d - radius;
  float env = exp(-(x*x)/(w*w));
  // amplitude decays with time AND with ring radius (mass, not just fade)
  float decay = exp(-age*0.85) / (1.0 + radius*0.010);
  // small phase drift = physical lag between crest and trough
  return rp.w * decay * env * cos(x*0.21 + age*1.6);
}

float height(vec2 p){
  float t = u_time * u_idleSpeed;
  float h = u_idle * (
      sin(p.x*0.0035 + t*1.3) * 0.5
    + sin(p.y*0.0042 - t*1.0) * 0.35
    + sin((p.x + p.y)*0.0022 + t*0.7) * 0.5
  );
  for (int i = 0; i < MAXR; i++){
    if (i >= u_count) break;
    h += ripH(p, u_rip[i], u_seed[i]);
  }
  return h;
}

vec3 bg(vec2 uv){
  vec3 teal = vec3(0.145, 0.475, 0.405);
  vec3 blue = vec3(0.088, 0.325, 0.505);
  vec3 deep = vec3(0.062, 0.262, 0.428);
  float diag = (uv.x*0.85 + uv.y*1.15) * 0.5;
  vec3 c = mix(teal, blue, smoothstep(0.0, 0.42, diag));
  c = mix(c, deep, smoothstep(0.45, 1.35, uv.x + uv.y));
  return c;
}

void main(){
  vec2 p = vec2(gl_FragCoord.x, u_res.y - gl_FragCoord.y);
  float eps = 2.5;
  float h0 = height(p);
  float hx = height(p + vec2(eps, 0.0));
  float hy = height(p + vec2(0.0, eps));
  vec3 n = normalize(vec3(-(hx - h0)/eps, -(hy - h0)/eps, 1.0));

  // gentle refraction of the gradient beneath
  vec2 uv = p / u_res;
  vec2 ruv = uv + n.xy * 0.035 * u_refr;
  vec3 col = bg(ruv);

  // subtle shading from surface tilt
  col *= 1.0 + n.x*0.10 - n.y*0.07;

  // faint blue-tinted crest light, no neon
  vec3 L = normalize(vec3(-0.42, -0.58, 0.72));
  float spec = pow(max(dot(n, L), 0.0), 60.0);
  col += vec3(0.42, 0.60, 0.72) * spec * 0.55 * u_hl;

  gl_FragColor = vec4(col, 1.0);
}
`;

class RupaWater extends HTMLElement {
  connectedCallback(){
    if (this._started) return;
    this._started = true;
    const C = this.C = Object.assign({}, WATER_CONFIG);
    // attribute overrides (DC tweaks)
    const num = (name) => { const v = this.getAttribute(name); return v == null || v === '' ? null : parseFloat(v); };
    this._attr = () => {
      const r = num('refraction'); if (r != null) C.rippleRefractionStrength = r;
      const h = num('highlight');  if (h != null) C.rippleHighlightStrength = h;
      const i = num('idle');       if (i != null) C.idleMotionStrength = WATER_CONFIG.idleMotionStrength * i;
      const a = num('amplitude');  if (a != null) C.rippleAmplitude = WATER_CONFIG.rippleAmplitude * a;
    };
    this._attr();

    this.reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.coarse = window.matchMedia('(pointer: coarse)').matches;
    if (this.coarse) C.maxRippleCount = Math.min(C.maxRippleCount, 10);

    Object.assign(this.style, { position:'fixed', inset:'0', zIndex:'0', pointerEvents:'none', display:'block' });
    const cv = this.canvas = document.createElement('canvas');
    Object.assign(cv.style, { position:'absolute', inset:'0', width:'100%', height:'100%' });
    this.appendChild(cv);

    const gl = this.gl = cv.getContext('webgl', { antialias:false, alpha:false, depth:false, stencil:false, powerPreference:'low-power' });
    if (!gl) { this.style.background = 'linear-gradient(135deg,#25796a,#16537f 45%,#104370)'; return; }

    const sh = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.error(gl.getShaderInfoLog(s));
      return s;
    };
    const prog = this.prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'a');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    this.U = {};
    ['u_res','u_time','u_rip','u_seed','u_count','u_idle','u_idleSpeed','u_refr','u_hl','u_speed','u_life']
      .forEach(n => this.U[n] = gl.getUniformLocation(prog, n));

    this.ripples = [];
    this.ripData = new Float32Array(16*4);
    this.seedData = new Float32Array(16);
    this.t0 = performance.now()/1000;
    this.lastP = null; this.lastT = 0; this.lastSpawn = -1; this.smSpeed = 0;

    this._onMove = (e) => this.pointerMove(e);
    this._onResize = () => this.resize();
    window.addEventListener('pointermove', this._onMove, { passive:true });
    window.addEventListener('pointerdown', this._onMove, { passive:true });
    window.addEventListener('resize', this._onResize);
    this.resize();

    const loop = () => {
      this._raf = requestAnimationFrame(loop);
      this.draw();
    };
    loop();
  }

  disconnectedCallback(){
    cancelAnimationFrame(this._raf);
    window.removeEventListener('pointermove', this._onMove);
    window.removeEventListener('pointerdown', this._onMove);
    window.removeEventListener('resize', this._onResize);
    this._started = false;
  }

  static get observedAttributes(){ return ['refraction','highlight','idle','amplitude']; }
  attributeChangedCallback(){ if (this._attr) this._attr(); }

  resize(){
    const C = this.C;
    const q = this.coarse ? C.mobileQualityScale : 1;
    const dpr = Math.min(window.devicePixelRatio || 1, 2) * q;
    this.scale = dpr;
    this.canvas.width = Math.round(window.innerWidth * dpr);
    this.canvas.height = Math.round(window.innerHeight * dpr);
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
  }

  now(){ return performance.now()/1000 - this.t0; }

  addRipple(x, y, birth, amp){
    const C = this.C;
    const t = this.now();
    this.ripples = this.ripples.filter(r => t - r.birth < C.rippleLifetime);
    if (this.ripples.length >= C.maxRippleCount) this.ripples.shift();
    this.ripples.push({ x: x*this.scale, y: y*this.scale, birth, amp, seed: Math.random() });
  }

  pointerMove(e){
    const C = this.C;
    const t = this.now();
    const x = e.clientX, y = e.clientY;
    if (this.lastP){
      const dt = Math.max(t - this.lastT, 0.004);
      const dx = x - this.lastP[0], dy = y - this.lastP[1];
      const dist = Math.hypot(dx, dy);
      const speed = dist / dt;
      this.smSpeed += (speed - this.smSpeed) * 0.35;
      if (dist > 2 && t - this.lastSpawn > C.rippleSpawnCooldown){
        const dirx = dx/dist, diry = dy/dist;
        const horiz = Math.abs(dirx); // 横・斜めで連続波紋が出やすい
        const s = this.smSpeed;
        let count, amp;
        if (this.reduced){
          count = 1; amp = C.rippleAmplitude * 0.5;
        } else if (s < C.slowSpeedThreshold){
          count = 1;
          amp = C.rippleAmplitude * (0.35 + 0.3 * (s / C.slowSpeedThreshold));
        } else if (s < C.fastSpeedThreshold){
          const k = (s - C.slowSpeedThreshold) / (C.fastSpeedThreshold - C.slowSpeedThreshold);
          count = 1 + Math.round(k * (1 + horiz * C.directionalBiasHorizontal) + Math.random()*0.6);
          amp = C.rippleAmplitude * (0.6 + 0.35*k);
        } else {
          const over = Math.min((s - C.fastSpeedThreshold) / C.fastSpeedThreshold, 1);
          count = Math.min(2 + Math.round(over*2 + horiz * C.directionalBiasHorizontal * 1.5 + Math.random()), 5);
          amp = C.rippleAmplitude * 1.0;
        }
        if (this.coarse) count = Math.min(count, 3);
        // skipping-stone placement: ahead along travel direction, uneven gaps
        const hop = 26 + Math.min(s*0.028, 60);
        let travel = 0, delay = 0;
        for (let i = 0; i < count; i++){
          const jx = (Math.random()-0.5) * 14, jy = (Math.random()-0.5) * 14;
          this.addRipple(x + dirx*travel + jx, y + diry*travel + jy, t + delay, amp * (1 - i*0.16));
          travel += hop * (0.75 + Math.random()*0.55);
          delay += 0.055 + Math.random()*0.05;
        }
        this.lastSpawn = t;
      }
    }
    this.lastP = [x, y];
    this.lastT = t;
  }

  draw(){
    const gl = this.gl, C = this.C, U = this.U;
    if (!gl) return;
    const t = this.now();
    this.ripples = this.ripples.filter(r => t - r.birth < C.rippleLifetime);
    const n = Math.min(this.ripples.length, 16);
    for (let i = 0; i < n; i++){
      const r = this.ripples[i];
      this.ripData[i*4] = r.x; this.ripData[i*4+1] = r.y;
      this.ripData[i*4+2] = r.birth; this.ripData[i*4+3] = r.amp * this.scale;
    }
    gl.uniform2f(U.u_res, this.canvas.width, this.canvas.height);
    gl.uniform1f(U.u_time, t);
    gl.uniform4fv(U.u_rip, this.ripData);
    for (let i = 0; i < n; i++) this.seedData[i] = this.ripples[i].seed;
    gl.uniform1fv(U.u_seed, this.seedData);
    gl.uniform1i(U.u_count, n);
    gl.uniform1f(U.u_idle, this.reduced ? 0.05 : C.idleMotionStrength * this.scale);
    gl.uniform1f(U.u_idleSpeed, C.idleMotionSpeed);
    gl.uniform1f(U.u_refr, C.rippleRefractionStrength);
    gl.uniform1f(U.u_hl, C.rippleHighlightStrength);
    gl.uniform1f(U.u_speed, C.rippleExpansionSpeed * this.scale);
    gl.uniform1f(U.u_life, C.rippleLifetime);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}

if (!customElements.get('rupa-water')) customElements.define('rupa-water', RupaWater);
