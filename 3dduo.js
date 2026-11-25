(function () {
  const BASE0 = (document.currentScript && document.currentScript.src) || document.baseURI;
    const THEMES = {
    gradient: { lines: [[1, 1, 1], [1, 1, 1]], op: 0.32, beam: [1, 1, 1] },
    sombre: { lines: [[0.933, 0.133, 0.22], [0.749, 0.114, 0.404]], op: 0.55, beam: [1, 1, 1] },
    rougenoir: { lines: [[0.933, 0.133, 0.22], [0.04, 0.04, 0.05]], op: 0.8, beam: [1, 0.35, 0.4] },
    clair: { lines: [[0.12, 0.12, 0.12], [0.45, 0.46, 0.46]], op: 0.22, beam: [0.933, 0.133, 0.22] },
  };
  const SEG = 420;
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
  const PFRAG = `uniform vec3 uBeam; uniform float uHard; varying float vA;
    void main(){ float r=length(gl_PointCoord-0.5)*2.0;
      if(uHard>0.5){ float d=1.0-smoothstep(0.94,1.0,r); if(d<0.01||vA<0.01) discard; gl_FragColor=vec4(0.933,0.133,0.22,d); return; }
      float g=exp(-r*r*5.0); if(g<0.01) discard; gl_FragColor=vec4(uBeam, g*vA); }`;

  // un seul effet 3D actif à la fois : celui dont la surface visible est la plus grande
  const REG = new Set();
  function arbitrate() {
    let best = null, ba = 0;
    REG.forEach((e) => { if (e._area > ba) { ba = e._area; best = e; } });
    if (best && ba < innerWidth * innerHeight * 0.18 && !best.hasAttribute('always')) best = null;
    REG.forEach((e) => { e._vis = e === best; e._kick && e._kick(); });
  }
  class Effect3D extends HTMLElement {
    static get observedAttributes() { return ['theme', 'count', 'speed', 'parallax', 'beam', 'spacing', 'intensity', 'shape', 'thick', 'warp']; }
    connectedCallback() {
      if (/[?&]no3d\b/.test(location.search) || /[?&]no3d\b/.test(document.referrer)) { this.style.display = 'none'; return; }
      this.style.display = 'block';
      this.style.position = this.style.position || 'absolute';
      if (!this.style.inset) this.style.inset = '0';
      if (this._started) return;
      this._started = true;
      import(new URL('three.module.js',BASE0).href).then((T) => this._init(T)).catch(() => {});
    }
    disconnectedCallback() { cancelAnimationFrame(this._raf); this._raf = 0; this._io && this._io.disconnect(); REG.delete(this); arbitrate(); this._onVis && document.removeEventListener('visibilitychange', this._onVis); this._ro && this._ro.disconnect(); this._onMove && window.removeEventListener('pointermove', this._onMove); this._started = false; }
    attributeChangedCallback(name, o, v) {
      if (!this._T || !this._lines) return;
      if (name === 'spacing' && o !== v) this._lines.forEach((L) => this._spawn(L, L.birth));
      this._applyTheme();
    }
    setScroll(p) { this._sp = p == null ? null : Math.max(0, Math.min(1, p)); }
    set parallax(v) { this.setAttribute('parallax', v); }
    get parallax() { const v = parseFloat(this.getAttribute('parallax')); return isNaN(v) ? 0.5 : v; }
    set beam(v) { this.setAttribute('beam', v); }
    get beam() { return parseFloat(this.getAttribute('beam')) || 7; }
    set spacing(v) { this.setAttribute('spacing', v); }
    get spacing() { return parseFloat(this.getAttribute('spacing')) || 6.8; }
    set theme(v) { this.setAttribute('theme', v); }
    get theme() { return this.getAttribute('theme') || 'clair'; }
    set speed(v) { this.setAttribute('speed', v); }
    get speed() { return parseFloat(this.getAttribute('speed')) || 1.8; }

    _init(T) {
      this._T = T;
      const r = (this._renderer = new T.WebGLRenderer({ antialias: true, alpha: true }));
      r.setPixelRatio(Math.min(1.5, window.devicePixelRatio || 1));
      r.setClearColor(0x000000, 0);
      r.domElement.style.cssText = 'display:block;width:100%;height:100%';
      this.appendChild(r.domElement);
      this._scene = new T.Scene();
      this._cam = new T.PerspectiveCamera(40, 1, 0.1, 100);
      this._cam.position.set(0, 0.6, 9.5);
      this._group = new T.Group();
      this._scene.add(this._group);
      const n = parseInt(this.getAttribute('count')) || 36;
      this._lines = [];
      const pPos = new Float32Array(n * 3), pA = new Float32Array(n);
      this._pGeo = new T.BufferGeometry();
      this._pGeo.setAttribute('position', new T.BufferAttribute(pPos, 3));
      this._pGeo.setAttribute('aA', new T.BufferAttribute(pA, 1));
      this._pMat = new T.ShaderMaterial({ vertexShader: PVERT, fragmentShader: PFRAG, transparent: true, depthWrite: false,
        uniforms: { uSize: { value: 26 }, uBeam: { value: new T.Color() }, uHard: { value: this.hasAttribute('dot') ? 1 : 0 } } });
      this._group.add(new T.Points(this._pGeo, this._pMat));
      for (let i = 0; i < n; i++) {
        const geo = new T.BufferGeometry();
        geo.setAttribute('position', new T.BufferAttribute(new Float32Array((SEG + 1) * 3), 3));
        const at = new Float32Array(SEG + 1);
        for (let k = 0; k <= SEG; k++) at[k] = k / SEG;
        geo.setAttribute('aT', new T.BufferAttribute(at, 1));
        const mat = new T.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false,
          uniforms: { uHead: { value: 0 }, uPulse: { value: 0 }, uFade: { value: 0 }, uOp: { value: 0.3 },
            uColor: { value: new T.Color() }, uBeam: { value: new T.Color() } } });
        const line = new T.Line(geo, mat);
        line.frustumCulled = false;
        this._group.add(line);
        const L = { line, geo, mat, i };
        this._spawn(L, 0.3 + L.i * (2.2 / n));
        this._lines.push(L);
      }
      this._applyTheme();
      if (this._want) this.setShape(this._want);
      this._ro = new ResizeObserver(() => this._resize());
      this._ro.observe(this);
      this._resize();
      this._mx = this._my = this._sx = this._sy = 0;
      this._onMove = (e) => {
        const b = this.getBoundingClientRect();
        this._mx = Math.max(-1, Math.min(1, ((e.clientX - b.left) / (b.width || 1)) * 2 - 1));
        this._my = Math.max(-1, Math.min(1, ((e.clientY - b.top) / (b.height || 1)) * 2 - 1));
      };
      window.addEventListener('pointermove', this._onMove, { passive: true });
      this._t0 = performance.now();
      this._last = this._t0;
      this._time = 0;
      // performance : on ne dessine que si l'élément est à l'écran et l'onglet visible
      this._vis = true;
      const loop = (now) => {
        if (!this._vis || document.hidden) { this._raf = 0; return; }
        this._raf = requestAnimationFrame(loop);
        const dt = Math.min(0.05, (now - this._last) / 1000) * this.speed;
        this._last = now;
        this._time += dt;
        this._tick(this._time, dt);
      };
      this._kick = () => { if (this._raf || !this._vis || document.hidden) return; this._last = performance.now(); this._raf = requestAnimationFrame(loop); };
      this._area = 0;
      this._io = new IntersectionObserver((es) => { const r = es[es.length - 1].intersectionRect; this._area = es[es.length - 1].isIntersecting ? r.width * r.height : 0; arbitrate(); }, { threshold: [0, 0.05, 0.1, 0.2, 0.35, 0.5, 0.65, 0.8, 1] });
      REG.add(this);
      this._io.observe(this);
      this._onVis = () => this._kick();
      document.addEventListener('visibilitychange', this._onVis);
      if (this.hasAttribute('dot')) {
        const d = document.createElement('i');
        d.setAttribute('aria-hidden', 'true');
        d.style.cssText = 'position:absolute;left:0;top:0;width:6px;height:6px;border-radius:50%;background:#EE2238;opacity:0;pointer-events:none;will-change:transform;z-index:2';
        this.appendChild(d); this._dotEl = d;
      }
      this._raf = requestAnimationFrame(loop);
      // préchauffage : compile les shaders et dessine une image hors écran, pour éviter la saccade au premier tracé
      if (this.hasAttribute('always')) {
        const warm = () => { try { this._renderer && this._renderer.compile && this._scene && this._cam && this._renderer.compile(this._scene, this._cam); this._tick(this._time || 0, 0.016); } catch (e) {} };
        (window.requestIdleCallback || ((f) => setTimeout(f, 500)))(() => setTimeout(warm, 300));
      }
    }
    _applyTheme() {
      const th = THEMES[this.theme] || THEMES.gradient;
      const n = this._lines.length;
      this._lines.forEach((L) => {
        const k = n > 1 ? L.i / (n - 1) : 0;
        const a = th.lines[0], b = th.lines[1];
        L.mat.uniforms.uColor.value.setRGB(a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k);
        L.mat.uniforms.uBeam.value.setRGB(...th.beam);
        L.mat.uniforms.uOp.value = Math.min(1, th.op * (parseFloat(this.getAttribute('intensity')) || 1)) * (0.6 + 0.4 * L.rnd);
        if (this.getAttribute('shape') === 'timeline') {
          // frise d'itération : 3 traits seulement, un rouge et deux noirs (clairs en mode sombre)
          const dk = this.theme === 'sombre', j = Math.round(L.i / 4), c = j === 0 ? [0.933, 0.133, 0.22] : (dk ? [0.88, 0.89, 0.93] : [0.05, 0.05, 0.07]);
          L.mat.uniforms.uColor.value.setRGB(c[0], c[1], c[2]);
          L.mat.uniforms.uOp.value = j === 0 ? 0.9 : (dk ? 0.6 : 0.7);
        }
        if (this.getAttribute('shape') === 'duo') {
          // deux fils rouges en dégradé : l'un rouge vif → magenta, l'autre corail clair → bordeaux
          const dk = this.theme === 'sombre', c = L.i % 2 ? (dk ? [[1, 0.42, 0.52], [0.72, 0.1, 0.27]] : [[0.93, 0.35, 0.45], [0.55, 0.06, 0.2]]) : [[0.93, 0.13, 0.22], [0.75, 0.11, 0.41]];
          L.mat.uniforms.uColor.value.setRGB(c[0][0] + (c[1][0] - c[0][0]) * k, c[0][1] + (c[1][1] - c[0][1]) * k, c[0][2] + (c[1][2] - c[0][2]) * k);
          L.mat.uniforms.uOp.value = dk ? 0.75 : 0.7;
        }
      });
      this._pMat.uniforms.uBeam.value.setRGB(...th.beam);
    }
    _roundPath() {
      // Z à coins arrondis : trait central + normales (échantillonné à pas régulier)
      if (this._rp) return this._rp;
      const S = 1.7, P = [[-S, S], [S, S], [-S, -S], [S, -S]], R = 0.62, pts = [P[0]];
      for (let c = 1; c <= 2; c++) {
        const a = P[c - 1], b = P[c], d = P[c + 1];
        const l1 = Math.hypot(b[0] - a[0], b[1] - a[1]), l2 = Math.hypot(d[0] - b[0], d[1] - b[1]);
        const p1 = [b[0] + (a[0] - b[0]) * Math.min(0.45, R / l1), b[1] + (a[1] - b[1]) * Math.min(0.45, R / l1)];
        const p2 = [b[0] + (d[0] - b[0]) * Math.min(0.45, R / l2), b[1] + (d[1] - b[1]) * Math.min(0.45, R / l2)];
        for (let k = 0; k <= 16; k++) { const t = k / 16, u = 1 - t; pts.push([u * u * p1[0] + 2 * u * t * b[0] + t * t * p2[0], u * u * p1[1] + 2 * u * t * b[1] + t * t * p2[1]]); }
      }
      pts.push(P[3]);
      const cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
      const tot = cum[cum.length - 1], out = [];
      let j = 0;
      for (let k = 0; k <= SEG; k++) {
        const d = (k / SEG) * tot;
        while (j < pts.length - 2 && d > cum[j + 1]) j++;
        const u = (d - cum[j]) / (cum[j + 1] - cum[j] || 1);
        const x = pts[j][0] + (pts[j + 1][0] - pts[j][0]) * u, y = pts[j][1] + (pts[j + 1][1] - pts[j][1]) * u;
        const tx = pts[j + 1][0] - pts[j][0], ty = pts[j + 1][1] - pts[j][1], tl = Math.hypot(tx, ty) || 1;
        out.push([x, y, -ty / tl, tx / tl]);
      }
      return (this._rp = out);
    }
    _loopPath(Rr, a0, sg) {
      const V = [], a1 = a0 + sg * Math.PI * 2 * (320 / 360);
      for (let k = 0; k <= 90; k++) { const a = a0 + (a1 - a0) * (k / 90); V.push([Rr * Math.cos(a), Rr * Math.sin(a)]); }
      const e = V[V.length - 1], ta = a1 + sg * Math.PI / 2, d = 0.1 + 0.22 * Rr;
      V.push([e[0] + d * Math.cos(ta + 2.5), e[1] + d * Math.sin(ta + 2.5)], e, [e[0] + d * Math.cos(ta - 2.5), e[1] + d * Math.sin(ta - 2.5)]);
      const cum = [0]; for (let i = 1; i < V.length; i++) cum.push(cum[i - 1] + Math.hypot(V[i][0] - V[i - 1][0], V[i][1] - V[i - 1][1]));
      const tot = cum[cum.length - 1], out = []; let j = 0;
      for (let k = 0; k <= SEG; k++) { const dd = (k / SEG) * tot; while (j < V.length - 2 && dd > cum[j + 1]) j++; const u = (dd - cum[j]) / (cum[j + 1] - cum[j] || 1);
        out.push([V[j][0] + (V[j + 1][0] - V[j][0]) * u, V[j][1] + (V[j + 1][1] - V[j][1]) * u]); }
      return out;
    }
    _loopGeom() {
      const W = this.clientWidth || innerWidth, H = this.clientHeight || innerHeight, z = this._cam.position.z, hh = Math.tan(20 * Math.PI / 180) * z, hw = hh * W / H;
      const cards = [].slice.call(document.querySelectorAll('#debat .card')).slice(0, 2).map((c) => c.getBoundingClientRect()).filter((r) => r.width > 0);
      if (cards.length < 2) return { cx: [-1.45, 1.45], cy: [0, 0], R: 1.45 };
      const u = (2 * hh) / H;
      return { cx: cards.map((r) => ((r.left + r.width / 2) / W * 2 - 1) * hw), cy: cards.map((r) => -((r.top + r.height / 2) / H * 2 - 1) * hh),
        R: Math.min(cards[0].width * 0.5, 330, Math.max(cards[0].height * 1.1, 130)) * u };
    }
    _tlGeom() {
      const W = this.clientWidth || innerWidth, H = this.clientHeight || innerHeight, z = this._cam.position.z, hh = Math.tan(20 * Math.PI / 180) * z, hw = hh * W / H, u = (2 * hh) / H;
      const wx = (px) => (px / W * 2 - 1) * hw, wy = (py) => -(py / H * 2 - 1) * hh;
      const rs = [].slice.call(document.querySelectorAll('#methode .card')).slice(0, 4).map((c) => c.getBoundingClientRect()).filter((r) => r.width > 0);
      if (rs.length === 4 && Math.abs(rs[0].top - rs[3].top) < 20) {
        const hgt = rs[0].height;
        return { cx: rs.map((r) => wx(r.left + r.width / 2)), y0: wy(rs[0].bottom - 22), R: Math.min(hgt * 0.42, rs[0].width * 0.36) * u, r: 24 * u, x0: wx(rs[0].left - 4), x1: wx(rs[3].right + 14) };
      }
      return { cx: [0.2, 0.4, 0.6, 0.8].map((f) => wx(W * f)), y0: wy(H * 0.9), R: Math.min(H * 0.1, W * 0.06) * u, r: Math.min(H * 0.04, W * 0.022) * u, x0: wx(W * 0.04), x1: wx(W * 0.96) };
    }
    _tlPath(g, rank) {
      const V = [[g.x0, g.y0]], loop = (c, rho) => { V.push([c - rho * 0.0, g.y0]); for (let k = 1; k <= 48; k++) { const a = -Math.PI / 2 + (k / 48) * Math.PI * 2; V.push([c + rho * Math.cos(a), g.y0 + rho + rho * Math.sin(a)]); } };
      const sc = 0.68 + 0.32 * rank;
      for (let i = 0; i < 4; i++) { loop(g.cx[i], g.R * sc); if (i < 3) loop((g.cx[i] + g.cx[i + 1]) / 2, g.r * sc); }
      V.push([g.x1 - 0.35, g.y0], [g.x1, g.y0], [g.x1 - 0.3, g.y0 + 0.2], [g.x1, g.y0], [g.x1 - 0.3, g.y0 - 0.2]);
      return this._samplePts(V);
    }
    _samplePts(V) {
      const cum = [0]; for (let i = 1; i < V.length; i++) cum.push(cum[i - 1] + Math.hypot(V[i][0] - V[i - 1][0], V[i][1] - V[i - 1][1]));
      const tot = cum[cum.length - 1], out = []; let j = 0;
      for (let k = 0; k <= SEG; k++) { const dd = (k / SEG) * tot; while (j < V.length - 2 && dd > cum[j + 1]) j++; const u = (dd - cum[j]) / (cum[j + 1] - cum[j] || 1);
        out.push([V[j][0] + (V[j + 1][0] - V[j][0]) * u, V[j][1] + (V[j + 1][1] - V[j][1]) * u]); }
      return out;
    }
    _duoGeom() {
      const W = this.clientWidth || innerWidth, H = this.clientHeight || innerHeight, z = this._cam.position.z, hh = Math.tan(20 * Math.PI / 180) * z, hw = hh * W / H;
      return { cx: 0, cy: 0, a: Math.min(hw * 0.62, hh * 1.6) };
    }
    setShape(s) {
      this._want = s;
      if (!this._lines || this._cur === s) return;
      this._cur = s;
      if (s !== 'z') this.setAttribute('shape', s); else this.removeAttribute('shape');
      this._lines.forEach((L) => this._spawn(L, (this._time || 0) + 0.15 + L.i * 0.05));
    }
    _spawn(L, birth) {
      L.line.position.set(0, 0, 0); L.line.rotation.z = 0; L.rot = 0; L.hidden = false; L.line.visible = true;
      if (this.getAttribute('shape') === 'duo') {
        // boucle infinie (lemniscate) : deux fils, un par rôle, qui tournent ensemble
        const N = parseInt(this.getAttribute('count')) || 36, k01 = N > 1 ? L.i / (N - 1) : 0.5, pos = L.geo.attributes.position.array, g = this._duoGeom();
        const sc = 0.82 + 0.18 * k01, oz = (0.5 - k01) * 1.1, ph = (L.i % 2) * 0.35;
        for (let k = 0; k <= SEG; k++) {
          const th = (k / SEG) * Math.PI * 2 + ph, d = 1 + Math.sin(th) * Math.sin(th);
          pos[k * 3] = g.cx + (g.a * sc * Math.cos(th)) / d;
          pos[k * 3 + 1] = g.cy + (g.a * sc * Math.sin(th) * Math.cos(th)) / d * 1.25;
          pos[k * 3 + 2] = oz + Math.sin(th * 2 + L.i) * 0.25;
        }
        L.geo.attributes.position.needsUpdate = true;
        L.birth = birth; L.grow = 7; L.hold = 12; L.back = 6; L.life = L.grow + L.hold + L.back + 1.5; L.period = 8 + k01 * 3; L.poff = (L.i % 2) * 0.5; L.rnd = 1 - k01 * 0.4;
        return;
      }
      if (this.getAttribute('shape') === 'timeline') {
        // timeline linéaire : un trait continu avec une boucle par étape (1 à 4) et des micro-boucles entre les étapes, tracé de gauche à droite
        const N = parseInt(this.getAttribute('count')) || 36, k01 = N > 1 ? L.i / (N - 1) : 0.5, pos = L.geo.attributes.position.array, g = this._tlGeom();
        L.hidden = L.i % 4 !== 0; L.line.visible = !L.hidden; // peu de traits : on lit chaque itération
        const path = this._tlPath(g, k01), dy = (k01 - 0.5) * 0.35, oz = (0.5 - k01) * 1.2;
        for (let k = 0; k <= SEG; k++) { pos[k * 3] = path[k][0]; pos[k * 3 + 1] = path[k][1] + dy; pos[k * 3 + 2] = oz; }
        L.geo.attributes.position.needsUpdate = true;
        L.birth = birth + L.i * 0.12; L.grow = 8; L.hold = 9; L.back = 5; L.life = L.grow + L.hold + L.back + 1.5; L.period = 6 + k01 * 2; L.poff = k01 * 0.5; L.rnd = 1;
        return;
      }
      if (this.getAttribute('shape') === 'hlines') {
        // lignes horizontales seules, empilées en hauteur et en profondeur, traversées par les faisceaux
        const N = parseInt(this.getAttribute('count')) || 36, k01 = N > 1 ? L.i / (N - 1) : 0.5, pos = L.geo.attributes.position.array;
        const y = (k01 - 0.5) * 5.4, z = (((L.i * 0.6180339) % 1) - 0.5) * 2.4;
        for (let k = 0; k <= SEG; k++) { pos[k * 3] = -6 + 12 * (k / SEG); pos[k * 3 + 1] = y; pos[k * 3 + 2] = z; }
        L.geo.attributes.position.needsUpdate = true;
        L.birth = birth; L.grow = 3; L.hold = 4.4; L.back = 3; L.life = L.grow + L.hold + L.back + 0.8; L.period = 1.8 + ((L.i * 0.37) % 1) * 1.8; L.poff = (L.i * 0.23) % 1; L.rnd = 1 - Math.abs(k01 - 0.5) * 0.8;
        return;
      }
      if (this.getAttribute('shape') === 'loops') {
        // deux boucles d'itération qui tournent en sens inverse ; chaque trait = une itération (rayon et profondeur qui évoluent)
        const N = parseInt(this.getAttribute('count')) || 36, k01 = N > 1 ? L.i / (N - 1) : 0.5, side = L.i % 2 ? 1 : -1, rank = (L.i >> 1) / Math.max(1, (N >> 1) - 1);
        const g = this._loopGeom(), ix = L.i % 2, path = this._loopPath(g.R * (0.6 + 0.4 * rank), 0.9 + rank * 0.5, side), pos = L.geo.attributes.position.array, oz = (0.5 - k01) * 1.4;
        for (let k = 0; k <= SEG; k++) { pos[k * 3] = path[k][0]; pos[k * 3 + 1] = path[k][1]; pos[k * 3 + 2] = oz; }
        L.geo.attributes.position.needsUpdate = true;
        L.line.position.set(g.cx[ix], g.cy[ix], 0); L.rot = -side; L.cx = g.cx[ix]; L.cy = g.cy[ix];
        L.birth = birth; L.grow = 3.2; L.hold = 4.2; L.back = 3.2; L.life = L.grow + L.hold + L.back + 0.8; L.period = 2.2 + rank * 1.2; L.poff = rank; L.rnd = 1 - k01 * 0.5;
        return;
      }
      if (this.getAttribute('shape') === 'round') {
        // bande épaisse : chaque trait a sa position dans l'épaisseur et sa profondeur, déformés par des ondulations
        const path = this._roundPath(), N = parseInt(this.getAttribute('count')) || 36;
        const th = parseFloat(this.getAttribute('thick')) || 0.5, wp = parseFloat(this.getAttribute('warp')) || 0.3;
        const k01 = N > 1 ? L.i / (N - 1) : 0.5;
        const off = (((L.i * 0.6180339) % 1) - 0.5) * 2 * th, ph = L.i * 1.7, ph2 = L.i * 0.9;
        const oz = (0.5 - k01) * this.spacing;
        const pos = L.geo.attributes.position.array;
        for (let k = 0; k <= SEG; k++) {
          const q = path[k], u = k / SEG;
          const w = off + wp * 0.22 * Math.sin(u * 6 + ph) * (0.4 + k01);
          pos[k * 3] = q[0] + q[2] * w + wp * 0.1 * Math.sin(u * 5 + ph2);
          pos[k * 3 + 1] = q[1] + q[3] * w + wp * 0.1 * Math.cos(u * 6 + ph);
          pos[k * 3 + 2] = oz + wp * 0.6 * Math.sin(u * 4 + ph2) + off * 0.8;
        }
        L.geo.attributes.position.needsUpdate = true;
        L.birth = birth; L.grow = 3.6; L.hold = 3.2; L.back = 3.6; L.life = L.grow + L.hold + L.back + 1.2; L.period = 2.6; L.poff = 0; L.rnd = 1 - k01 * 0.6;
        return;
      }
      // Tracé du Z : haut-gauche → haut-droite → bas-gauche → bas-droite, chaque trait décalé en profondeur (3D)
      const S = 1.7, P = [[-S, S], [S, S], [-S, -S], [S, -S]];
      const segLen = [], tot = [0];
      for (let j = 0; j < 3; j++) { const l = Math.hypot(P[j + 1][0] - P[j][0], P[j + 1][1] - P[j][1]); segLen.push(l); tot.push(tot[j] + l); }
      const N = parseInt(this.getAttribute('count')) || 36;
      const k01 = N > 1 ? L.i / (N - 1) : 0.5;
      const oz = (0.5 - k01) * this.spacing;
      const pos = L.geo.attributes.position.array;
      for (let k = 0; k <= SEG; k++) {
        const d = (k / SEG) * tot[3];
        let j = d < tot[1] ? 0 : d < tot[2] ? 1 : 2;
        const u = (d - tot[j]) / segLen[j];
        pos[k * 3] = P[j][0] + (P[j + 1][0] - P[j][0]) * u;
        pos[k * 3 + 1] = P[j][1] + (P[j + 1][1] - P[j][1]) * u;
        pos[k * 3 + 2] = oz;
      }
      L.geo.attributes.position.needsUpdate = true;
      L.birth = birth;
      L.grow = 3.6; L.hold = 3.2; L.back = 3.6;
      L.life = L.grow + L.hold + L.back + 1.2;
      L.period = 2.6;
      L.poff = 0;
      L.rnd = 1 - k01 * 0.6;
    }
    _tick(t, dt) {
      this._sx += (this._mx - this._sx) * 0.07;
      this._sy += (this._my - this._sy) * 0.07;
      { const flat = ['hlines', 'loops', 'timeline', 'duo'].indexOf(this._cur) >= 0, tx = flat ? 0 : (this._bx || 0), ty = flat ? 0 : (this._by || 0); this._group.position.x += (tx - this._group.position.x) * 0.06; this._group.position.y += (ty - this._group.position.y) * 0.06; }
      const px = this.parallax;
      { const hl = ['hlines', 'loops', 'timeline', 'duo'].indexOf(this._cur) >= 0;
        this._group.rotation.y = (hl ? 0 : -0.6) + Math.sin(t * 0.1) * (hl ? 0.04 : 0.3) + this._sx * 0.75 * px * (hl ? 0.12 : 1);
        this._group.rotation.x = (hl ? 0 : 0.22) + Math.sin(t * 0.07) * (hl ? 0.01 : 0.06) + this._sy * 0.45 * px * (hl ? 0.1 : 1);
        if (this._cur === 'duo') { this._group.rotation.y = Math.sin(t * 0.18) * 0.7 + this._sx * 0.15 * px; this._group.rotation.x = 0.1 + Math.sin(t * 0.14) * 0.06; } }
      this._pMat.uniforms.uSize.value = this.beam;
      const pPos = this._pGeo.attributes.position.array, pA = this._pGeo.attributes.aA.array;
      this._lines.forEach((L, idx) => {
        let age = t - L.birth;
        const u = L.mat.uniforms;
        const sc = this._sp != null, st2 = this._cur === 'timeline' && this.hasAttribute('static');
        if (L.hidden || (!sc && !st2 && age < 0)) { u.uFade.value = 0; pA[idx] = 0; return; }
        if (!sc) age = age % L.life;
        const ease = (x) => x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;
        let head, pulse;
        if (st2) { head = 1; pulse = ((t * 0.6) / L.period + L.poff) % 1; }
        else if (sc) {
          const st = (L.i / Math.max(1, this._lines.length - 1)) * 0.12;
          const q = Math.max(0, Math.min(1, (this._sp - st) / (1 - 0.12)));
          head = ease(q);
          pulse = q < 1 ? head : ((t * 0.6) / L.period + L.poff) % 1;
        }
        else if (age < L.grow) { head = ease(age / L.grow); pulse = head; }
        else if (age < L.grow + L.hold) { head = 1; pulse = ((age - L.grow) / L.period + L.poff) % 1; }
        else if (age < L.grow + L.hold + L.back) { head = 1 - ease((age - L.grow - L.hold) / L.back); pulse = head; }
        else { head = 0; pulse = 0; }
        const fade = head > 0.001 ? 1 : 0;
        u.uHead.value = head; u.uFade.value = fade; u.uPulse.value = pulse;
        const pk = Math.min(SEG, Math.max(0, Math.round(Math.min(pulse, head) * SEG)));
        const arr = L.geo.attributes.position.array;
        if (L.rot) {
          const ang = L.rot * t * 0.55, cs = Math.cos(ang), sn = Math.sin(ang), x = arr[pk * 3], y = arr[pk * 3 + 1];
          L.line.rotation.z = ang;
          pPos[idx * 3] = L.cx + x * cs - y * sn; pPos[idx * 3 + 1] = L.cy + x * sn + y * cs;
        } else { pPos[idx * 3] = arr[pk * 3]; pPos[idx * 3 + 1] = arr[pk * 3 + 1]; }
        pPos[idx * 3 + 2] = arr[pk * 3 + 2];
        pA[idx] = fade * (pulse <= head + 0.001 ? 0.9 : 0);
        if (this._dotEl) { this._dotP = this._dotP || this._cam.position.clone(); this._dotP.set(pPos[idx * 3], pPos[idx * 3 + 1], pPos[idx * 3 + 2]); this._dotOn = pA[idx] > 0; pA[idx] = 0; }
      });
      this._pGeo.attributes.position.needsUpdate = true;
      this._pGeo.attributes.aA.needsUpdate = true;
      this._renderer.render(this._scene, this._cam);
      if (this._dotEl) {
        const d = this._dotEl;
        if (this._dotOn && this._dotP) {
          const v = this._dotP.clone(); this._group.localToWorld(v); v.project(this._cam);
          const w = this.clientWidth, h = this.clientHeight;
          d.style.transform = 'translate3d(' + ((v.x * 0.5 + 0.5) * w - 3).toFixed(2) + 'px,' + ((-v.y * 0.5 + 0.5) * h - 3).toFixed(2) + 'px,0)';
          d.style.opacity = '1';
        } else d.style.opacity = '0';
      }
    }
    _resize() {
      const w = this.clientWidth || 1, h = this.clientHeight || 1;
      this._renderer.setSize(w, h, false);
      this._cam.aspect = w / h;
      this._cam.position.set(0, 0, this.getAttribute('align') === 'center' ? (w / h < 1 ? 15 : 10.6) : (w / h < 1 ? 15 : 12));
      this._cam.lookAt(0, 0, 0);
      const ctr = this.getAttribute('align') === 'center';
      this._group.position.set(ctr ? 0 : (w / h > 1.3 ? 3.2 : 0), ctr ? 0.1 : (w / h > 1.3 ? 0.3 : 0.8), 0);
      this._bx = this._group.position.x; this._by = this._group.position.y;
      if (['loops', 'timeline', 'duo'].indexOf(this._cur) >= 0 && this._lines) this._lines.forEach((L) => this._spawn(L, L.birth));
      this._cam.updateProjectionMatrix();
    }
  }
  if (!customElements.get('effect-3d-duo')) customElements.define('effect-3d-duo', Effect3D);
})();