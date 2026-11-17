// <effect-3d-morph> — figure 3D en lignes + faisceaux, fixe à l'écran, qui change de forme (Z → case cochée → horloge)
// Pilotée par la page : el.setMorph(v) (0 = Z, 1 = cercle d'itération, 2 = timeline, 3 = ligne), el.setPlace(k) (0 = centré, 1 = sur le côté), theme="clair|gradient|sombre"
(function () {
  const BASE = (document.currentScript && document.currentScript.src) || document.baseURI;
  const THEMES = {
    gradient: { lines: [[1, 1, 1], [1, 1, 1]], op: 0.34, beam: [1, 1, 1] },
    sombre: { lines: [[0.933, 0.133, 0.22], [0.749, 0.114, 0.404]], op: 0.55, beam: [1, 1, 1] },
    clair: { lines: [[0.12, 0.12, 0.12], [0.45, 0.46, 0.46]], op: 0.26, beam: [0.933, 0.133, 0.22] },
  };
  const SEG = 420, S = 1.7;
  const VERT = `attribute float aT; varying float vT;
    void main(){ vT=aT; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`;
  const FRAG = `uniform float uHead,uPulse,uFade,uOp; uniform vec3 uColor,uBeam; varying float vT;
    void main(){
      if(vT>uHead) discard;
      float d=uPulse-vT;
      float beam = d>=0.0 ? exp(-d*55.0) : exp(d*900.0);
      float tip = smoothstep(uHead-0.04,uHead,vT)*0.6;
      float a = clamp(uOp + beam*0.95 + tip*uOp, 0.0, 1.0) * uFade;
      vec3 c = mix(uColor, uBeam, clamp(beam*1.2+tip*0.3,0.0,1.0));
      gl_FragColor=vec4(c,a);
    }`;
  const PVERT = `attribute float aA; varying float vA; uniform float uSize;
    void main(){ vA=aA; vec4 mv=modelViewMatrix*vec4(position,1.0); gl_PointSize=uSize*(10.0/-mv.z); gl_Position=projectionMatrix*mv; }`;
  const PFRAG = `uniform vec3 uBeam; varying float vA;
    void main(){ float r=length(gl_PointCoord-0.5)*2.0; float g=exp(-r*r*5.0); if(g<0.01) discard; gl_FragColor=vec4(uBeam, g*vA); }`;

  function sample(V, n) {
    const cum = [0];
    for (let i = 0; i < V.length - 1; i++) cum.push(cum[i] + Math.hypot(V[i + 1][0] - V[i][0], V[i + 1][1] - V[i][1]));
    const tot = cum[cum.length - 1], out = new Float32Array(n * 2);
    let j = 0;
    for (let k = 0; k < n; k++) {
      const d = (k / (n - 1)) * tot;
      while (j < V.length - 2 && d > cum[j + 1]) j++;
      const u = (d - cum[j]) / (cum[j + 1] - cum[j] || 1);
      out[2 * k] = V[j][0] + (V[j + 1][0] - V[j][0]) * u;
      out[2 * k + 1] = V[j][1] + (V[j + 1][1] - V[j][1]) * u;
    }
    return out;
  }
  // 1 · cercle d'itération : arc de 320° + pointe de flèche
  const LOOP = [], R = 1.6, A0 = 0.9, A1 = A0 + Math.PI * 2 * (320 / 360);
  for (let k = 0; k <= 90; k++) { const a = A0 + (A1 - A0) * (k / 90); LOOP.push([R * Math.cos(a), R * Math.sin(a)]); }
  { const e = LOOP[LOOP.length - 1], ta = A1 + Math.PI / 2, d = 0.5;
    const b1 = [e[0] + d * Math.cos(ta + 2.5), e[1] + d * Math.sin(ta + 2.5)], b2 = [e[0] + d * Math.cos(ta - 2.5 + 0.0), e[1] + d * Math.sin(ta - 2.5)];
    LOOP.push(b1, e, b2); }
  // 2 · timeline : axe horizontal, repères alternés, flèche
  const TL = [[-2.6, 0]]; [-2.1, -1.05, 0, 1.05, 2.1].forEach((x, i) => { const h = i % 2 ? 0.55 : 0.95; TL.push([x, 0], [x, h], [x, 0]); });
  TL.push([2.6, 0], [2.3, 0.22], [2.6, 0], [2.3, -0.22]);
  const SHAPES = [
    sample([[-S, S], [S, S], [-S, -S], [S, -S]], SEG + 1),   // 0 · Z
    sample(LOOP, SEG + 1),                                   // 1 · cercle d'itération
    sample(TL, SEG + 1),                                     // 2 · timeline
    sample([[-2.7, 0], [2.7, 0]], SEG + 1),                  // 3 · simple ligne
  ];
  const ease = (x) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2);

  class Effect3DMorph extends HTMLElement {
    static get observedAttributes() { return ['theme']; }
    connectedCallback() {
      this.style.cssText += ';display:block;position:fixed;inset:0;pointer-events:none';
      if (this._started) return; this._started = true;
      import(new URL('three.module.js', BASE).href).then((T) => this._init(T));
    }
    disconnectedCallback() { cancelAnimationFrame(this._raf); this._ro && this._ro.disconnect(); this._onMove && window.removeEventListener('pointermove', this._onMove); this._started = false; }
    attributeChangedCallback() { if (this._T && this._lines) this._applyTheme(); }
    setMorph(v) { this._mt = Math.max(0, Math.min(SHAPES.length - 1, v)); }
    setPlace(k) { this._pt = Math.max(0, Math.min(1, k)); }
    get theme() { return this.getAttribute('theme') || 'clair'; }
    _init(T) {
      this._T = T;
      const r = (this._renderer = new T.WebGLRenderer({ antialias: true, alpha: true }));
      r.setPixelRatio(Math.min(2, window.devicePixelRatio || 1)); r.setClearColor(0x000000, 0);
      r.domElement.style.cssText = 'display:block;width:100%;height:100%';
      this.appendChild(r.domElement);
      this._scene = new T.Scene(); this._cam = new T.PerspectiveCamera(40, 1, 0.1, 100);
      this._group = new T.Group(); this._scene.add(this._group);
      const n = (this._n = parseInt(this.getAttribute('count')) || 30), spacing = parseFloat(this.getAttribute('spacing')) || 5.2;
      this._lines = [];
      this._pGeo = new T.BufferGeometry();
      this._pGeo.setAttribute('position', new T.BufferAttribute(new Float32Array(n * 3), 3));
      this._pGeo.setAttribute('aA', new T.BufferAttribute(new Float32Array(n), 1));
      this._pMat = new T.ShaderMaterial({ vertexShader: PVERT, fragmentShader: PFRAG, transparent: true, depthWrite: false, uniforms: { uSize: { value: 7 }, uBeam: { value: new T.Color() } } });
      this._group.add(new T.Points(this._pGeo, this._pMat));
      for (let i = 0; i < n; i++) {
        const geo = new T.BufferGeometry();
        geo.setAttribute('position', new T.BufferAttribute(new Float32Array((SEG + 1) * 3), 3));
        const at = new Float32Array(SEG + 1); for (let k = 0; k <= SEG; k++) at[k] = k / SEG;
        geo.setAttribute('aT', new T.BufferAttribute(at, 1));
        const mat = new T.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false,
          uniforms: { uHead: { value: 0 }, uPulse: { value: 0 }, uFade: { value: 0 }, uOp: { value: 0.3 }, uColor: { value: new T.Color() }, uBeam: { value: new T.Color() } } });
        const line = new T.Line(geo, mat); line.frustumCulled = false; this._group.add(line);
        const k01 = n > 1 ? i / (n - 1) : 0.5;
        this._lines.push({ line, geo, mat, i, oz: (0.5 - k01) * spacing, birth: 0.3 + i * (2.2 / n), rnd: 1 - k01 * 0.6 });
      }
      this._m = 0; this._mt = 0; this._p = 0; this._pt = 0; this._k = -1;
      this._applyTheme();
      this._ro = new ResizeObserver(() => this._resize()); this._ro.observe(this); this._resize();
      this._mx = this._my = this._sx = this._sy = 0;
      this._onMove = (e) => { this._mx = (e.clientX / (innerWidth || 1)) * 2 - 1; this._my = (e.clientY / (innerHeight || 1)) * 2 - 1; };
      window.addEventListener('pointermove', this._onMove, { passive: true });
      this._last = performance.now(); this._time = 0;
      this._cx = 0; this._cy = 0; this._cs = 1;
      const loop = (now) => { this._raf = requestAnimationFrame(loop); const dt = Math.min(0.05, (now - this._last) / 1000); this._last = now; this._time += dt; this._tick(this._time, dt); };
      this._raf = requestAnimationFrame(loop);
    }
    _applyTheme() {
      const th = THEMES[this.theme] || THEMES.clair, n = this._lines.length;
      this._lines.forEach((L) => {
        const k = n > 1 ? L.i / (n - 1) : 0, a = th.lines[0], b = th.lines[1];
        L.mat.uniforms.uColor.value.setRGB(a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k);
        L.mat.uniforms.uBeam.value.setRGB(...th.beam);
        L.mat.uniforms.uOp.value = th.op * (0.6 + 0.4 * L.rnd);
      });
      this._pMat.uniforms.uBeam.value.setRGB(...th.beam);
    }
    _resize() {
      const w = this.clientWidth || 1, h = this.clientHeight || 1;
      this._renderer.setSize(w, h, false);
      this._cam.aspect = w / h; this._cam.position.set(0, 0, w / h < 1 ? 14 : 9.2); this._cam.lookAt(0, 0, 0);
      this._cam.updateProjectionMatrix();
      const hh = Math.tan((20 * Math.PI) / 180) * this._cam.position.z; this._hh = hh; this._hw = hh * (w / h);
      this._k = -1;
    }
    _tick(t, dt) {
      this._m += (this._mt - this._m) * Math.min(1, dt * 3.2);
      this._p += (this._pt - this._p) * Math.min(1, dt * 3.2);
      // forme courante (mélange de deux formes voisines)
      if (Math.abs(this._m - this._k) > 1e-4) {
        this._k = this._m;
        const a = Math.min(SHAPES.length - 2, Math.floor(this._m)), f0 = this._m - a, f = f0 * f0 * (3 - 2 * f0), A = SHAPES[a], B = SHAPES[a + 1];
        this._lines.forEach((L) => {
          const pos = L.geo.attributes.position.array;
          for (let k = 0; k <= SEG; k++) { pos[3 * k] = A[2 * k] + (B[2 * k] - A[2 * k]) * f; pos[3 * k + 1] = A[2 * k + 1] + (B[2 * k + 1] - A[2 * k + 1]) * f; pos[3 * k + 2] = L.oz; }
          L.geo.attributes.position.needsUpdate = true;
        });
      }
      // placement : centre (grand) → côté (petit)
      const p = ease(this._p), narrow = this._cam.aspect < 1.1;
      const s = 1 - 0.42 * p;
      const x = narrow ? 0 : p * (this._hw - 1.7 * s - 0.7);
      const y = narrow ? -p * (this._hh - 1.7 * s - 0.5) : 0;
      this._group.position.set(x, y, 0);
      // grand écran : la figure grandit, et la timeline / la ligne s'étirent sur toute la largeur
      const big = narrow ? 1 : Math.min(1.7, Math.max(1, this._cam.aspect / 1.6)), s2 = s * (narrow ? 0.8 : big);
      const wide = narrow ? 1 : Math.max(1, (this._hw * 0.92) / (2.7 * s2)), mm = this._m, wf = mm <= 1 ? 1 : mm <= 2 ? 1 + (wide - 1) * (mm - 1) : wide;
      this._group.scale.set(s2 * wf, s2, s2);
      this._sx += (this._mx - this._sx) * 0.07; this._sy += (this._my - this._sy) * 0.07;
      this._group.rotation.y = -0.25 + Math.sin(t * 0.1) * 0.22 + this._sx * 0.7;
      this._group.rotation.x = 0.2 + Math.sin(t * 0.07) * 0.05 + this._sy * 0.42;
      const pPos = this._pGeo.attributes.position.array, pA = this._pGeo.attributes.aA.array;
      this._lines.forEach((L, idx) => {
        const age = t - L.birth, u = L.mat.uniforms;
        if (age < 0) { u.uFade.value = 0; pA[idx] = 0; return; }
        const grow = 3.2, head = age < grow ? ease(age / grow) : 1;
        const pulse = age < grow ? head : (((age - grow) / 2.8 + idx * 0.045) % 1);
        u.uHead.value = head; u.uFade.value = head > 0.001 ? 1 : 0; u.uPulse.value = pulse;
        const pk = Math.min(SEG, Math.max(0, Math.round(Math.min(pulse, head) * SEG))), arr = L.geo.attributes.position.array;
        pPos[idx * 3] = arr[pk * 3]; pPos[idx * 3 + 1] = arr[pk * 3 + 1]; pPos[idx * 3 + 2] = arr[pk * 3 + 2];
        pA[idx] = head > 0.001 ? 0.9 : 0;
      });
      this._pGeo.attributes.position.needsUpdate = true; this._pGeo.attributes.aA.needsUpdate = true;
      this._renderer.render(this._scene, this._cam);
    }
  }
  if (!customElements.get('effect-3d-morph')) customElements.define('effect-3d-morph', Effect3DMorph);
})();
