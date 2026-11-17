// <effect-3d> — Z 3D en lignes + faisceaux lumineux (three.js 0.160, chargé à la volée)
// Usage :
//   <script src="3deffect.js"></script>
//   <div style="position:relative;height:100vh">
//     <effect-3d theme="clair" count="36" speed="1.8" spacing="6.8" beam="7" parallax="0.5"></effect-3d>
//   </div>
// Attributs (tous optionnels, modifiables à chaud sauf count) :
//   theme    gradient | sombre | clair   (couleurs des lignes ; le fond reste à la charge du conteneur)
//   count    nombre de traits empilés en profondeur (défaut 36)
//   speed    vitesse d'animation (défaut 1.8)
//   spacing  profondeur totale de l'empilement (défaut 6.8)
//   beam     taille du point lumineux (défaut 7)
//   parallax intensité du suivi de la souris, 0 = désactivé (défaut 0.5)
// L'élément remplit son parent (position:absolute; inset:0).
(function () {
  const BASE = (document.currentScript && document.currentScript.src) || document.baseURI;
  const THEMES = {
    gradient: { lines: [[1, 1, 1], [1, 1, 1]], op: 0.32, beam: [1, 1, 1] },
    sombre: { lines: [[0.933, 0.133, 0.22], [0.749, 0.114, 0.404]], op: 0.55, beam: [1, 1, 1] },
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
  const PFRAG = `uniform vec3 uBeam; varying float vA;
    void main(){ float r=length(gl_PointCoord-0.5)*2.0; float g=exp(-r*r*5.0); if(g<0.01) discard; gl_FragColor=vec4(uBeam, g*vA); }`;

  class Effect3D extends HTMLElement {
    static get observedAttributes() { return ['theme', 'count', 'speed', 'parallax', 'beam', 'spacing', 'intensity']; }
    connectedCallback() {
      this.style.display = 'block';
      this.style.position = this.style.position || 'absolute';
      if (!this.style.inset) this.style.inset = '0';
      if (this._started) return;
      this._started = true;
      import(new URL('three.module.js', BASE).href).then((T) => this._init(T));
    }
    disconnectedCallback() { cancelAnimationFrame(this._raf); this._ro && this._ro.disconnect(); this._onMove && window.removeEventListener('pointermove', this._onMove); this._started = false; }
    attributeChangedCallback(name, o, v) {
      if (!this._T || !this._lines) return;
      if (name === 'spacing' && o !== v) this._lines.forEach((L) => this._spawn(L, L.birth));
      this._applyTheme();
    }
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
      r.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
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
        uniforms: { uSize: { value: 26 }, uBeam: { value: new T.Color() } } });
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
      const loop = (now) => {
        this._raf = requestAnimationFrame(loop);
        const dt = Math.min(0.05, (now - this._last) / 1000) * this.speed;
        this._last = now;
        this._time += dt;
        this._tick(this._time, dt);
      };
      this._raf = requestAnimationFrame(loop);
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
      });
      this._pMat.uniforms.uBeam.value.setRGB(...th.beam);
    }
    _spawn(L, birth) {
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
      const px = this.parallax;
      this._group.rotation.y = -0.6 + Math.sin(t * 0.1) * 0.3 + this._sx * 0.75 * px;
      this._group.rotation.x = 0.22 + Math.sin(t * 0.07) * 0.06 + this._sy * 0.45 * px;
      this._pMat.uniforms.uSize.value = this.beam;
      const pPos = this._pGeo.attributes.position.array, pA = this._pGeo.attributes.aA.array;
      this._lines.forEach((L, idx) => {
        let age = t - L.birth;
        const u = L.mat.uniforms;
        if (age < 0) { u.uFade.value = 0; pA[idx] = 0; return; }
        age = age % L.life;
        const ease = (x) => x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;
        let head, pulse;
        if (age < L.grow) { head = ease(age / L.grow); pulse = head; }
        else if (age < L.grow + L.hold) { head = 1; pulse = ((age - L.grow) / L.period + L.poff) % 1; }
        else if (age < L.grow + L.hold + L.back) { head = 1 - ease((age - L.grow - L.hold) / L.back); pulse = head; }
        else { head = 0; pulse = 0; }
        const fade = head > 0.001 ? 1 : 0;
        u.uHead.value = head; u.uFade.value = fade; u.uPulse.value = pulse;
        const pk = Math.min(SEG, Math.max(0, Math.round(Math.min(pulse, head) * SEG)));
        const arr = L.geo.attributes.position.array;
        pPos[idx * 3] = arr[pk * 3]; pPos[idx * 3 + 1] = arr[pk * 3 + 1]; pPos[idx * 3 + 2] = arr[pk * 3 + 2];
        pA[idx] = fade * (pulse <= head + 0.001 ? 0.9 : 0);
      });
      this._pGeo.attributes.position.needsUpdate = true;
      this._pGeo.attributes.aA.needsUpdate = true;
      this._renderer.render(this._scene, this._cam);
    }
    _resize() {
      const w = this.clientWidth || 1, h = this.clientHeight || 1;
      this._renderer.setSize(w, h, false);
      this._cam.aspect = w / h;
      this._cam.position.set(0, 0, this.getAttribute('align') === 'center' ? (w / h < 1 ? 13 : 8.6) : (w / h < 1 ? 15 : 12));
      this._cam.lookAt(0, 0, 0);
      const ctr = this.getAttribute('align') === 'center';
      this._group.position.set(ctr ? 0 : (w / h > 1.3 ? 3.2 : 0), ctr ? 0.1 : (w / h > 1.3 ? 0.3 : 0.8), 0);
      this._cam.updateProjectionMatrix();
    }
  }
  if (!customElements.get('effect-3d')) customElements.define('effect-3d', Effect3D);
})();
