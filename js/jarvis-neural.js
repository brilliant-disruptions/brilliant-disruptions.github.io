/**
 * jarvis-neural.js — Three.js neuron-network "brain" for the JARVIS demo.
 *
 * Renders a two-lobe field of glowing neurons connected by synapse edges, with
 * signal pulses that travel node-to-node and cascade. The whole network reacts
 * to interaction states (idle / listening / thinking / speaking) driven by the
 * voice layer in jarvis-voice.js.
 *
 * Mirrors the proven patterns in scene.js: custom glow ShaderMaterial, additive
 * blending, Float32Array buffers, a requestAnimationFrame loop, and the
 * 280.0 / -z perspective point sizing.
 *
 * Public API (window.NeuralScene):
 *   init(canvasId)        — build the scene and start the render loop
 *   setState(name)        — 'idle' | 'listening' | 'thinking' | 'speaking'
 *   pulse({ count })      — manually seed a burst of pulses (used per spoken word)
 *   setAmplitude(0..1)    — transient activity bump (e.g. speech loudness)
 *   isSupported()         — false when WebGL/THREE are unavailable
 *   destroy()             — stop the loop and release resources
 */

(function () {
  'use strict';

  const isMobile = window.innerWidth < 768;
  const NODE_COUNT  = isMobile ? 140 : 320;
  const NEIGHBORS   = isMobile ? 3 : 4;
  const MAX_PULSES  = isMobile ? 50 : 120;
  const MAX_EDGE_DIST = 1.6;
  const ELLIPSOID   = { x: 3.4, y: 2.4, z: 2.8 };
  const HEMI_GAP    = 0.35;

  const reduceMotion = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ─── State profiles (animate loop eases live values toward these) ──────────
  const TINTS = {
    cyan:    [0.0, 0.9, 1.0],
    violet:  [0.49, 0.23, 0.93],
    magenta: [1.0, 0.0, 0.43]
  };
  const STATE_PROFILES = {
    idle:      { activity: 0.15, pulseSpeed: 0.8, seedRate: 0.7,  propagation: 0.12, edgeOpacity: 0.12, tint: 'cyan',    tintAmount: 0.25 },
    listening: { activity: 0.55, pulseSpeed: 1.3, seedRate: 2.5,  propagation: 0.20, edgeOpacity: 0.28, tint: 'cyan',    tintAmount: 0.45 },
    thinking:  { activity: 1.00, pulseSpeed: 2.6, seedRate: 8.0,  propagation: 0.45, edgeOpacity: 0.50, tint: 'violet',  tintAmount: 0.7  },
    speaking:  { activity: 0.75, pulseSpeed: 1.6, seedRate: 0.0,  propagation: 0.25, edgeOpacity: 0.35, tint: 'magenta', tintAmount: 0.65 }
  };

  let renderer, scene, camera, clock, rafId;
  let nodePoints, nodeGeo, nodeMat;
  let pulsePoints, pulseGeo, pulseMat;
  let synapses, edgeMat;
  let nodes = [], edges = [], adj = [];
  let livePulses = [];
  let nodeActivations; // Float32Array, per-frame brightness
  let pulsePositions;  // Float32Array buffer for the pulse Points
  let pulseSizes;

  let currentState = 'idle';
  let target = STATE_PROFILES.idle;
  let liveActivity = 0.15;
  let tintCurrent = TINTS.cyan.slice();
  let tintAmount = 0.25;
  let ampBump = 0;        // transient extra activity from setAmplitude
  let seedAccumulator = 0;
  let mouseWorld = { x: 0, y: 0 };
  let supported = true;

  function lerp(a, b, t) { return a + (b - a) * t; }
  function dist(a, b) {
    const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  // ─── Node generation: two-lobe ellipsoid ──────────────────────────────────
  function generateNodes(n) {
    const out = [];
    for (let i = 0; i < n; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      // Bias radius toward the shell for a cortex-like surface density
      const r = 0.55 + 0.45 * Math.cbrt(Math.random());
      let x = r * Math.sin(phi) * Math.cos(theta) * ELLIPSOID.x;
      const y = r * Math.sin(phi) * Math.sin(theta) * ELLIPSOID.y;
      const z = r * Math.cos(phi) * ELLIPSOID.z;
      x += x < 0 ? -HEMI_GAP : HEMI_GAP; // split into left/right lobes
      out.push({
        x, y, z,
        home: { x, y, z },
        activation: 0,
        drift: {
          x: (Math.random() - 0.5) * 0.0006,
          y: (Math.random() - 0.5) * 0.0006,
          z: (Math.random() - 0.5) * 0.0006
        }
      });
    }
    return out;
  }

  // ─── Synapse edges: kNN with distance cap + adjacency list ─────────────────
  function buildEdges(list) {
    const result = [];
    const seen = new Set();
    adj = list.map(() => []);
    for (let i = 0; i < list.length; i++) {
      const cands = [];
      for (let j = 0; j < list.length; j++) {
        if (i === j) continue;
        const d = dist(list[i], list[j]);
        if (d <= MAX_EDGE_DIST) cands.push({ j, d });
      }
      cands.sort((p, q) => p.d - q.d);
      const k = Math.min(NEIGHBORS, cands.length);
      for (let c = 0; c < k; c++) {
        const j = cands[c].j;
        const key = i < j ? i + '_' + j : j + '_' + i;
        if (seen.has(key)) continue;
        seen.add(key);
        const edgeIndex = result.length;
        result.push({ a: i, b: j, len: cands[c].d });
        adj[i].push(edgeIndex);
        adj[j].push(edgeIndex);
      }
    }
    return result;
  }

  // ─── Build geometry ────────────────────────────────────────────────────────
  function buildNodeGeometry() {
    const N = nodes.length;
    const positions = new Float32Array(N * 3);
    const colors = new Float32Array(N * 3);
    const sizes = new Float32Array(N);
    nodeActivations = new Float32Array(N);

    for (let i = 0; i < N; i++) {
      positions[i * 3] = nodes[i].x;
      positions[i * 3 + 1] = nodes[i].y;
      positions[i * 3 + 2] = nodes[i].z;
      // Base palette: mostly cyan, some violet, occasional white highlight
      const t = Math.random();
      if (t < 0.65) {
        colors[i * 3] = 0.0 + Math.random() * 0.1;
        colors[i * 3 + 1] = 0.8 + Math.random() * 0.2;
        colors[i * 3 + 2] = 0.9 + Math.random() * 0.1;
      } else if (t < 0.9) {
        colors[i * 3] = 0.4 + Math.random() * 0.2;
        colors[i * 3 + 1] = 0.15 + Math.random() * 0.2;
        colors[i * 3 + 2] = 0.9 + Math.random() * 0.1;
      } else {
        colors[i * 3] = 0.85 + Math.random() * 0.15;
        colors[i * 3 + 1] = 0.85 + Math.random() * 0.15;
        colors[i * 3 + 2] = 1.0;
      }
      sizes[i] = Math.random() * 2.6 + 1.4;
    }

    nodeGeo = new THREE.BufferGeometry();
    nodeGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    nodeGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    nodeGeo.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
    nodeGeo.setAttribute('aActivation', new THREE.BufferAttribute(nodeActivations, 1));

    nodeMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uGlobalActivity: { value: liveActivity },
        uTint: { value: new THREE.Color(tintCurrent[0], tintCurrent[1], tintCurrent[2]) },
        uTintAmount: { value: tintAmount }
      },
      vertexShader: `
        attribute float size;
        attribute float aActivation;
        attribute vec3 color;
        varying vec3 vColor;
        varying float vGlow;
        uniform float uTime;
        uniform float uGlobalActivity;

        void main() {
          vColor = color;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          float idle = sin(uTime * 1.5 + position.x * 3.7 + position.y * 2.1) * 0.3 + 0.7;
          float fire = aActivation;
          vGlow = idle * 0.5 + fire + uGlobalActivity * 0.4;
          float boost = 1.0 + fire * 2.2 + uGlobalActivity * 0.6;
          gl_PointSize = size * boost * (300.0 / -mvPosition.z);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        varying float vGlow;
        uniform vec3 uTint;
        uniform float uTintAmount;

        void main() {
          vec2 uv = gl_PointCoord - vec2(0.5);
          float d = length(uv);
          if (d > 0.5) discard;
          float core = 1.0 - smoothstep(0.0, 0.15, d);
          float glow = 1.0 - smoothstep(0.1, 0.5, d);
          float alpha = (core * 0.9 + glow * 0.5) * vGlow;
          vec3 tinted = mix(vColor, uTint, uTintAmount);
          gl_FragColor = vec4(tinted, alpha);
        }
      `,
      transparent: true,
      vertexColors: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });

    nodePoints = new THREE.Points(nodeGeo, nodeMat);
    scene.add(nodePoints);
  }

  function buildEdgeGeometry() {
    const edgePos = new Float32Array(edges.length * 2 * 3);
    const edgeCol = new Float32Array(edges.length * 2 * 3);
    for (let k = 0; k < edges.length; k++) {
      const a = nodes[edges[k].a], b = nodes[edges[k].b];
      edgePos.set([a.x, a.y, a.z, b.x, b.y, b.z], k * 6);
      edgeCol.set([0.0, 0.3, 0.4, 0.25, 0.1, 0.45], k * 6);
    }
    const edgeGeo = new THREE.BufferGeometry();
    edgeGeo.setAttribute('position', new THREE.BufferAttribute(edgePos, 3));
    edgeGeo.setAttribute('color', new THREE.BufferAttribute(edgeCol, 3));
    edgeMat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.12,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    synapses = new THREE.LineSegments(edgeGeo, edgeMat);
    scene.add(synapses);
  }

  function buildPulseGeometry() {
    pulsePositions = new Float32Array(MAX_PULSES * 3);
    pulseSizes = new Float32Array(MAX_PULSES);
    const pulseColors = new Float32Array(MAX_PULSES * 3);
    for (let i = 0; i < MAX_PULSES; i++) {
      pulsePositions[i * 3] = 9999; // park off-screen until used
      pulseSizes[i] = 0;
      pulseColors[i * 3] = 0.6; pulseColors[i * 3 + 1] = 0.95; pulseColors[i * 3 + 2] = 1.0;
    }
    pulseGeo = new THREE.BufferGeometry();
    pulseGeo.setAttribute('position', new THREE.BufferAttribute(pulsePositions, 3));
    pulseGeo.setAttribute('size', new THREE.BufferAttribute(pulseSizes, 1));
    pulseGeo.setAttribute('color', new THREE.BufferAttribute(pulseColors, 3));
    pulseMat = new THREE.ShaderMaterial({
      uniforms: { uTint: nodeMat.uniforms.uTint },
      vertexShader: `
        attribute float size;
        attribute vec3 color;
        varying vec3 vColor;
        void main() {
          vColor = color;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * (300.0 / -mvPosition.z);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        uniform vec3 uTint;
        void main() {
          vec2 uv = gl_PointCoord - vec2(0.5);
          float d = length(uv);
          if (d > 0.5) discard;
          float a = 1.0 - smoothstep(0.0, 0.5, d);
          gl_FragColor = vec4(mix(vColor, uTint, 0.4), a);
        }
      `,
      transparent: true,
      vertexColors: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    pulsePoints = new THREE.Points(pulseGeo, pulseMat);
    scene.add(pulsePoints);
  }

  // ─── Pulses ─────────────────────────────────────────────────────────────────
  function spawnPulse(edgeIndex, fromNode) {
    if (livePulses.length >= MAX_PULSES) return;
    const e = edges[edgeIndex];
    if (!e) return;
    const dir = fromNode === e.a ? 1 : -1;
    livePulses.push({ edge: edgeIndex, dir: dir, t: 0, speed: 0.9 / Math.max(e.len, 0.3) });
  }

  function seedRandomPulses(count) {
    for (let c = 0; c < count; c++) {
      if (!edges.length) return;
      const node = (Math.random() * nodes.length) | 0;
      const list = adj[node];
      if (list && list.length) {
        spawnPulse(list[(Math.random() * list.length) | 0], node);
      }
    }
  }

  function updatePulses(delta) {
    const speedMul = target.pulseSpeed;
    const propagation = target.propagation;
    // Reset buffer (park unused points off-screen)
    for (let i = 0; i < MAX_PULSES; i++) pulseSizes[i] = 0;

    for (let p = livePulses.length - 1; p >= 0; p--) {
      const pulse = livePulses[p];
      pulse.t += pulse.speed * delta * speedMul;
      const e = edges[pulse.edge];
      const from = pulse.dir > 0 ? nodes[e.a] : nodes[e.b];
      const to = pulse.dir > 0 ? nodes[e.b] : nodes[e.a];
      const tt = Math.min(pulse.t, 1);
      const slot = p % MAX_PULSES;
      pulsePositions[slot * 3] = lerp(from.x, to.x, tt);
      pulsePositions[slot * 3 + 1] = lerp(from.y, to.y, tt);
      pulsePositions[slot * 3 + 2] = lerp(from.z, to.z, tt);
      pulseSizes[slot] = 5.0;

      if (pulse.t >= 1) {
        const arrived = pulse.dir > 0 ? e.b : e.a;
        nodes[arrived].activation = Math.min(1, nodes[arrived].activation + 0.9);
        const list = adj[arrived];
        for (let n = 0; n < list.length; n++) {
          if (list[n] !== pulse.edge && Math.random() < propagation) {
            spawnPulse(list[n], arrived);
          }
        }
        livePulses.splice(p, 1);
      }
    }
    pulseGeo.attributes.position.needsUpdate = true;
    pulseGeo.attributes.size.needsUpdate = true;
  }

  // ─── Animate ────────────────────────────────────────────────────────────────
  function animate() {
    rafId = requestAnimationFrame(animate);
    if (document.hidden) return;
    const delta = Math.min(clock.getDelta(), 0.05);
    const elapsed = clock.getElapsedTime();

    // Ease global values toward the active state profile
    const effectiveActivity = Math.min(1.5, target.activity + ampBump);
    liveActivity = lerp(liveActivity, effectiveActivity, delta * 3);
    ampBump *= 0.9;
    edgeMat.opacity = lerp(edgeMat.opacity, target.edgeOpacity, delta * 3);
    tintAmount = lerp(tintAmount, target.tintAmount, delta * 2);
    const tt = TINTS[target.tint];
    tintCurrent[0] = lerp(tintCurrent[0], tt[0], delta * 2);
    tintCurrent[1] = lerp(tintCurrent[1], tt[1], delta * 2);
    tintCurrent[2] = lerp(tintCurrent[2], tt[2], delta * 2);

    nodeMat.uniforms.uTime.value = elapsed;
    nodeMat.uniforms.uGlobalActivity.value = liveActivity;
    nodeMat.uniforms.uTintAmount.value = tintAmount;
    nodeMat.uniforms.uTint.value.setRGB(tintCurrent[0], tintCurrent[1], tintCurrent[2]);

    // Seed ambient pulses according to state (skip if reduced motion + idle)
    const seedRate = (reduceMotion && currentState === 'idle') ? 0 : target.seedRate;
    seedAccumulator += seedRate * delta;
    while (seedAccumulator >= 1) {
      seedRandomPulses(1);
      seedAccumulator -= 1;
    }

    updatePulses(delta);

    // Node drift + activation decay, write into buffers
    const pos = nodeGeo.attributes.position.array;
    const cam = camera.position;
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      node.x += node.drift.x;
      node.y += node.drift.y;
      node.z += node.drift.z;
      // Soft anchor back toward home so the cloud keeps its shape
      node.drift.x -= (node.x - node.home.x) * 0.00004;
      node.drift.y -= (node.y - node.home.y) * 0.00004;
      node.drift.z -= (node.z - node.home.z) * 0.00004;
      node.activation *= 0.92;

      pos[i * 3] = node.x;
      pos[i * 3 + 1] = node.y;
      pos[i * 3 + 2] = node.z;
      nodeActivations[i] = node.activation;
    }
    nodeGeo.attributes.position.needsUpdate = true;
    nodeGeo.attributes.aActivation.needsUpdate = true;

    // Gentle camera parallax toward the pointer
    cam.x += (mouseWorld.x * 0.4 - cam.x) * delta * 1.5;
    cam.y += (mouseWorld.y * 0.4 - cam.y) * delta * 1.5;
    camera.lookAt(0, 0, 0);

    renderer.render(scene, camera);
  }

  // ─── Public API ──────────────────────────────────────────────────────────────
  function setState(name) {
    if (!STATE_PROFILES[name]) return;
    currentState = name;
    target = STATE_PROFILES[name];
    if (name === 'thinking') seedRandomPulses(isMobile ? 6 : 12); // immediate burst
    window.dispatchEvent(new CustomEvent('neural:state', { detail: name }));
  }

  function pulse(opts) {
    const count = (opts && opts.count) || 1;
    seedRandomPulses(count);
  }

  function setAmplitude(level) {
    ampBump = Math.max(0, Math.min(1, level || 0));
  }

  function isSupported() { return supported; }

  function destroy() {
    if (rafId) cancelAnimationFrame(rafId);
    window.removeEventListener('resize', onResize);
    window.removeEventListener('mousemove', onMouseMove);
    if (renderer) renderer.dispose();
  }

  function onResize() {
    if (!renderer) return;
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  }

  function onMouseMove(e) {
    const nx = (e.clientX / window.innerWidth) * 2 - 1;
    const ny = -((e.clientY / window.innerHeight) * 2 - 1);
    mouseWorld.x = nx;
    mouseWorld.y = ny;
  }

  function init(canvasId) {
    const canvas = document.getElementById(canvasId || 'neural-canvas');
    const hasWebGL = (function () {
      try {
        return !!(window.WebGLRenderingContext &&
          (canvas.getContext('webgl') || canvas.getContext('experimental-webgl')));
      } catch (e) { return false; }
    })();
    if (!canvas || typeof THREE === 'undefined' || !hasWebGL) {
      supported = false;
      if (canvas) canvas.classList.add('neural-unsupported');
      return false;
    }

    clock = new THREE.Clock();
    renderer = new THREE.WebGLRenderer({
      canvas: canvas,
      alpha: true,
      antialias: false,
      powerPreference: 'high-performance'
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setClearColor(0x000000, 0);

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.z = 8;

    nodes = generateNodes(NODE_COUNT);
    edges = buildEdges(nodes);
    buildNodeGeometry();
    buildEdgeGeometry();
    buildPulseGeometry();

    window.addEventListener('resize', onResize);
    window.addEventListener('mousemove', onMouseMove);
    setState('idle');
    animate();
    return true;
  }

  window.NeuralScene = { init, setState, pulse, setAmplitude, isSupported, destroy };
})();
