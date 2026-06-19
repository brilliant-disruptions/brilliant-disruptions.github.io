/**
 * NeuralScene — a Three.js neuron-network "brain" for the JARVIS interface.
 *
 * Renders a two-lobe field of glowing neurons connected by synapse edges, with
 * signal pulses that travel node-to-node and cascade. The network reacts to
 * interaction states (idle / listening / thinking / speaking).
 *
 * Framework-agnostic: construct with a <canvas>, call init(), drive with
 * setState()/pulse(), and dispose() on unmount. Used by the React page at
 * app/(app)/neural/page.tsx.
 */

import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";

export type NeuralState = "idle" | "listening" | "thinking" | "speaking" | "greeting";

type Vec3 = { x: number; y: number; z: number };
type Node = { x: number; y: number; z: number; home: Vec3; activation: number; drift: Vec3 };
type Edge = { a: number; b: number; len: number };
type Pulse = { edge: number; dir: number; t: number; speed: number };

type Profile = {
  activity: number;
  pulseSpeed: number;
  seedRate: number;
  propagation: number;
  edgeOpacity: number;
  tint: "cyan" | "violet" | "magenta";
  tintAmount: number;
};

const TINTS: Record<Profile["tint"], [number, number, number]> = {
  cyan: [0.0, 0.9, 1.0],
  violet: [0.49, 0.23, 0.93],
  magenta: [0.96, 0.12, 0.48],
};

const STATE_PROFILES: Record<NeuralState, Profile> = {
  idle: { activity: 0.15, pulseSpeed: 0.8, seedRate: 0.45, propagation: 0.12, edgeOpacity: 0.12, tint: "cyan", tintAmount: 0.25 },
  listening: { activity: 0.55, pulseSpeed: 1.3, seedRate: 2.5, propagation: 0.2, edgeOpacity: 0.28, tint: "cyan", tintAmount: 0.45 },
  thinking: { activity: 1.0, pulseSpeed: 2.6, seedRate: 8.0, propagation: 0.45, edgeOpacity: 0.5, tint: "violet", tintAmount: 0.7 },
  speaking: { activity: 0.75, pulseSpeed: 1.6, seedRate: 0.0, propagation: 0.25, edgeOpacity: 0.35, tint: "magenta", tintAmount: 0.65 },
  greeting: { activity: 1.15, pulseSpeed: 2.6, seedRate: 10.0, propagation: 0.4, edgeOpacity: 0.6, tint: "magenta", tintAmount: 0.85 },
};

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export class NeuralScene {
  private canvas: HTMLCanvasElement;
  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private clock!: THREE.Clock;
  private rafId = 0;

  private composer: EffectComposer | null = null;
  private bloomPass: UnrealBloomPass | null = null;
  private useBloom = false;

  private nodeGeo!: THREE.BufferGeometry;
  private nodeMat!: THREE.ShaderMaterial;
  private pulseGeo!: THREE.BufferGeometry;
  private edgeMat!: THREE.LineBasicMaterial;

  private nodes: Node[] = [];
  private edges: Edge[] = [];
  private adj: number[][] = [];
  private livePulses: Pulse[] = [];
  private nodeActivations!: Float32Array;
  private pulsePositions!: Float32Array;
  private pulseSizes!: Float32Array;

  private currentState: NeuralState = "idle";
  private target: Profile = STATE_PROFILES.idle;
  private liveActivity = 0.15;
  private tintCurrent: [number, number, number] = [...TINTS.cyan];
  private tintAmount = 0.25;
  private ampBump = 0;
  private seedAccumulator = 0;
  private mouse = { x: 0, y: 0 };
  private supported = true;
  private colorCycle = false;
  private greetTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly isMobile: boolean;
  private readonly NODE_COUNT: number;
  private readonly NEIGHBORS: number;
  private readonly MAX_PULSES: number;
  private readonly MAX_EDGE_DIST = 1.6;
  private readonly reduceMotion: boolean;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.isMobile = typeof window !== "undefined" && window.innerWidth < 768;
    this.NODE_COUNT = this.isMobile ? 140 : 320;
    this.NEIGHBORS = this.isMobile ? 3 : 4;
    this.MAX_PULSES = this.isMobile ? 50 : 120;
    this.reduceMotion =
      typeof window !== "undefined" &&
      !!window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.onResize = this.onResize.bind(this);
    this.onMouseMove = this.onMouseMove.bind(this);
    this.animate = this.animate.bind(this);
  }

  isSupported() {
    return this.supported;
  }

  init(): boolean {
    const hasWebGL = (() => {
      try {
        return !!(
          window.WebGLRenderingContext &&
          (this.canvas.getContext("webgl") || this.canvas.getContext("experimental-webgl"))
        );
      } catch {
        return false;
      }
    })();
    if (!hasWebGL) {
      this.supported = false;
      return false;
    }

    this.clock = new THREE.Clock();
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      alpha: true,
      antialias: false,
      powerPreference: "high-performance",
    });
    const dpr = Math.min(window.devicePixelRatio, 2);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(window.innerWidth, window.innerHeight);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
    // Pulled back so the neuron cluster reads as a compact "little brain" that
    // sits inside the HUD's inner ring rather than filling the viewport.
    this.camera.position.z = 10;

    this.nodes = this.generateNodes(this.NODE_COUNT);
    this.edges = this.buildEdges(this.nodes);
    this.buildNodeGeometry();
    this.buildEdgeGeometry();
    this.buildPulseGeometry();

    // Cinematic bloom (desktop only). Renders opaque over the HUD's void so the
    // glow reads cleanly; mobile keeps the cheaper transparent direct render.
    this.useBloom = !this.isMobile && !this.reduceMotion;
    if (this.useBloom) {
      this.renderer.setClearColor(0x04060a, 1);
      this.composer = new EffectComposer(this.renderer);
      this.composer.setPixelRatio(dpr);
      this.composer.setSize(window.innerWidth, window.innerHeight);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      this.bloomPass = new UnrealBloomPass(
        new THREE.Vector2(window.innerWidth, window.innerHeight),
        0.5, // strength (modulated by activity in animate)
        0.42, // radius
        0.05, // threshold
      );
      this.composer.addPass(this.bloomPass);
    } else {
      this.renderer.setClearColor(0x000000, 0);
    }

    window.addEventListener("resize", this.onResize);
    window.addEventListener("mousemove", this.onMouseMove);
    this.setState("idle");
    this.animate();
    return true;
  }

  // ─── Node generation: two-lobe ellipsoid ─────────────────────────────────
  private generateNodes(n: number): Node[] {
    const ELL = { x: 3.4, y: 2.4, z: 2.8 };
    const HEMI_GAP = 0.35;
    const out: Node[] = [];
    for (let i = 0; i < n; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const r = 0.55 + 0.45 * Math.cbrt(Math.random());
      let x = r * Math.sin(phi) * Math.cos(theta) * ELL.x;
      const y = r * Math.sin(phi) * Math.sin(theta) * ELL.y;
      const z = r * Math.cos(phi) * ELL.z;
      x += x < 0 ? -HEMI_GAP : HEMI_GAP;
      out.push({
        x,
        y,
        z,
        home: { x, y, z },
        activation: 0,
        drift: {
          x: (Math.random() - 0.5) * 0.0006,
          y: (Math.random() - 0.5) * 0.0006,
          z: (Math.random() - 0.5) * 0.0006,
        },
      });
    }
    return out;
  }

  private dist(a: Node, b: Node) {
    const dx = a.x - b.x,
      dy = a.y - b.y,
      dz = a.z - b.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  // ─── Synapse edges: kNN with distance cap + adjacency list ────────────────
  private buildEdges(list: Node[]): Edge[] {
    const result: Edge[] = [];
    const seen = new Set<string>();
    this.adj = list.map(() => []);
    for (let i = 0; i < list.length; i++) {
      const cands: { j: number; d: number }[] = [];
      for (let j = 0; j < list.length; j++) {
        if (i === j) continue;
        const d = this.dist(list[i], list[j]);
        if (d <= this.MAX_EDGE_DIST) cands.push({ j, d });
      }
      cands.sort((p, q) => p.d - q.d);
      const k = Math.min(this.NEIGHBORS, cands.length);
      for (let c = 0; c < k; c++) {
        const j = cands[c].j;
        const key = i < j ? `${i}_${j}` : `${j}_${i}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const edgeIndex = result.length;
        result.push({ a: i, b: j, len: cands[c].d });
        this.adj[i].push(edgeIndex);
        this.adj[j].push(edgeIndex);
      }
    }
    return result;
  }

  private buildNodeGeometry() {
    const N = this.nodes.length;
    const positions = new Float32Array(N * 3);
    const colors = new Float32Array(N * 3);
    const sizes = new Float32Array(N);
    this.nodeActivations = new Float32Array(N);

    for (let i = 0; i < N; i++) {
      positions[i * 3] = this.nodes[i].x;
      positions[i * 3 + 1] = this.nodes[i].y;
      positions[i * 3 + 2] = this.nodes[i].z;
      const t = Math.random();
      if (t < 0.6) {
        // cyan
        colors[i * 3] = 0.0 + Math.random() * 0.1;
        colors[i * 3 + 1] = 0.8 + Math.random() * 0.2;
        colors[i * 3 + 2] = 0.9 + Math.random() * 0.1;
      } else if (t < 0.82) {
        // violet
        colors[i * 3] = 0.4 + Math.random() * 0.2;
        colors[i * 3 + 1] = 0.15 + Math.random() * 0.2;
        colors[i * 3 + 2] = 0.9 + Math.random() * 0.1;
      } else if (t < 0.92) {
        // gold accent
        colors[i * 3] = 1.0;
        colors[i * 3 + 1] = 0.72 + Math.random() * 0.12;
        colors[i * 3 + 2] = 0.28 + Math.random() * 0.1;
      } else {
        // white highlight
        colors[i * 3] = 0.85 + Math.random() * 0.15;
        colors[i * 3 + 1] = 0.85 + Math.random() * 0.15;
        colors[i * 3 + 2] = 1.0;
      }
      sizes[i] = Math.random() * 2.0 + 1.1;
    }

    this.nodeGeo = new THREE.BufferGeometry();
    this.nodeGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    this.nodeGeo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    this.nodeGeo.setAttribute("size", new THREE.BufferAttribute(sizes, 1));
    this.nodeGeo.setAttribute("aActivation", new THREE.BufferAttribute(this.nodeActivations, 1));

    this.nodeMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uGlobalActivity: { value: this.liveActivity },
        uTint: { value: new THREE.Color(...this.tintCurrent) },
        uTintAmount: { value: this.tintAmount },
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
      blending: THREE.AdditiveBlending,
    });

    this.scene.add(new THREE.Points(this.nodeGeo, this.nodeMat));
  }

  private buildEdgeGeometry() {
    const edgePos = new Float32Array(this.edges.length * 2 * 3);
    const edgeCol = new Float32Array(this.edges.length * 2 * 3);
    for (let k = 0; k < this.edges.length; k++) {
      const a = this.nodes[this.edges[k].a],
        b = this.nodes[this.edges[k].b];
      edgePos.set([a.x, a.y, a.z, b.x, b.y, b.z], k * 6);
      edgeCol.set([0.0, 0.3, 0.4, 0.25, 0.1, 0.45], k * 6);
    }
    const edgeGeo = new THREE.BufferGeometry();
    edgeGeo.setAttribute("position", new THREE.BufferAttribute(edgePos, 3));
    edgeGeo.setAttribute("color", new THREE.BufferAttribute(edgeCol, 3));
    this.edgeMat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.12,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.scene.add(new THREE.LineSegments(edgeGeo, this.edgeMat));
  }

  private buildPulseGeometry() {
    this.pulsePositions = new Float32Array(this.MAX_PULSES * 3);
    this.pulseSizes = new Float32Array(this.MAX_PULSES);
    const pulseColors = new Float32Array(this.MAX_PULSES * 3);
    for (let i = 0; i < this.MAX_PULSES; i++) {
      this.pulsePositions[i * 3] = 9999;
      this.pulseSizes[i] = 0;
      pulseColors[i * 3] = 0.6;
      pulseColors[i * 3 + 1] = 0.95;
      pulseColors[i * 3 + 2] = 1.0;
    }
    this.pulseGeo = new THREE.BufferGeometry();
    this.pulseGeo.setAttribute("position", new THREE.BufferAttribute(this.pulsePositions, 3));
    this.pulseGeo.setAttribute("size", new THREE.BufferAttribute(this.pulseSizes, 1));
    this.pulseGeo.setAttribute("color", new THREE.BufferAttribute(pulseColors, 3));
    const pulseMat = new THREE.ShaderMaterial({
      uniforms: { uTint: this.nodeMat.uniforms.uTint },
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
      blending: THREE.AdditiveBlending,
    });
    this.scene.add(new THREE.Points(this.pulseGeo, pulseMat));
  }

  // ─── Pulses ───────────────────────────────────────────────────────────────
  private spawnPulse(edgeIndex: number, fromNode: number) {
    if (this.livePulses.length >= this.MAX_PULSES) return;
    const e = this.edges[edgeIndex];
    if (!e) return;
    const dir = fromNode === e.a ? 1 : -1;
    this.livePulses.push({ edge: edgeIndex, dir, t: 0, speed: 0.9 / Math.max(e.len, 0.3) });
  }

  private seedRandomPulses(count: number) {
    for (let c = 0; c < count; c++) {
      if (!this.edges.length) return;
      const node = Math.floor(Math.random() * this.nodes.length);
      const list = this.adj[node];
      if (list && list.length) this.spawnPulse(list[Math.floor(Math.random() * list.length)], node);
    }
  }

  private updatePulses(delta: number) {
    const speedMul = this.target.pulseSpeed;
    const propagation = this.target.propagation;
    for (let i = 0; i < this.MAX_PULSES; i++) this.pulseSizes[i] = 0;

    for (let p = this.livePulses.length - 1; p >= 0; p--) {
      const pulse = this.livePulses[p];
      pulse.t += pulse.speed * delta * speedMul;
      const e = this.edges[pulse.edge];
      const from = pulse.dir > 0 ? this.nodes[e.a] : this.nodes[e.b];
      const to = pulse.dir > 0 ? this.nodes[e.b] : this.nodes[e.a];
      const tt = Math.min(pulse.t, 1);
      const slot = p % this.MAX_PULSES;
      this.pulsePositions[slot * 3] = lerp(from.x, to.x, tt);
      this.pulsePositions[slot * 3 + 1] = lerp(from.y, to.y, tt);
      this.pulsePositions[slot * 3 + 2] = lerp(from.z, to.z, tt);
      this.pulseSizes[slot] = 5.0;

      if (pulse.t >= 1) {
        const arrived = pulse.dir > 0 ? e.b : e.a;
        this.nodes[arrived].activation = Math.min(1, this.nodes[arrived].activation + 0.9);
        const list = this.adj[arrived];
        for (let n = 0; n < list.length; n++) {
          if (list[n] !== pulse.edge && Math.random() < propagation) this.spawnPulse(list[n], arrived);
        }
        this.livePulses.splice(p, 1);
      }
    }
    this.pulseGeo.attributes.position.needsUpdate = true;
    this.pulseGeo.attributes.size.needsUpdate = true;
  }

  // ─── Animate ──────────────────────────────────────────────────────────────
  private animate() {
    this.rafId = requestAnimationFrame(this.animate);
    if (typeof document !== "undefined" && document.hidden) return;
    const delta = Math.min(this.clock.getDelta(), 0.05);
    const elapsed = this.clock.getElapsedTime();

    const effectiveActivity = Math.min(1.5, this.target.activity + this.ampBump);
    this.liveActivity = lerp(this.liveActivity, effectiveActivity, delta * 3);
    this.ampBump *= 0.9;
    this.edgeMat.opacity = lerp(this.edgeMat.opacity, this.target.edgeOpacity, delta * 3);
    if (this.colorCycle) {
      // Sweep vividly through the three brand colors for the greeting burst.
      const cols = [TINTS.cyan, TINTS.violet, TINTS.magenta];
      const seg = (elapsed * 0.45) % 3;
      const i0 = Math.floor(seg) % 3;
      const i1 = (i0 + 1) % 3;
      const f = seg - Math.floor(seg);
      this.tintCurrent[0] = lerp(cols[i0][0], cols[i1][0], f);
      this.tintCurrent[1] = lerp(cols[i0][1], cols[i1][1], f);
      this.tintCurrent[2] = lerp(cols[i0][2], cols[i1][2], f);
      this.tintAmount = lerp(this.tintAmount, 0.92, delta * 3);
    } else {
      this.tintAmount = lerp(this.tintAmount, this.target.tintAmount, delta * 2);
      const tt = TINTS[this.target.tint];
      this.tintCurrent[0] = lerp(this.tintCurrent[0], tt[0], delta * 2);
      this.tintCurrent[1] = lerp(this.tintCurrent[1], tt[1], delta * 2);
      this.tintCurrent[2] = lerp(this.tintCurrent[2], tt[2], delta * 2);
    }

    this.nodeMat.uniforms.uTime.value = elapsed;
    this.nodeMat.uniforms.uGlobalActivity.value = this.liveActivity;
    this.nodeMat.uniforms.uTintAmount.value = this.tintAmount;
    (this.nodeMat.uniforms.uTint.value as THREE.Color).setRGB(
      this.tintCurrent[0],
      this.tintCurrent[1],
      this.tintCurrent[2],
    );

    const seedRate = this.reduceMotion && this.currentState === "idle" ? 0 : this.target.seedRate;
    this.seedAccumulator += seedRate * delta;
    while (this.seedAccumulator >= 1) {
      this.seedRandomPulses(1);
      this.seedAccumulator -= 1;
    }

    this.updatePulses(delta);

    const pos = this.nodeGeo.attributes.position.array as Float32Array;
    for (let i = 0; i < this.nodes.length; i++) {
      const node = this.nodes[i];
      node.x += node.drift.x;
      node.y += node.drift.y;
      node.z += node.drift.z;
      node.drift.x -= (node.x - node.home.x) * 0.00004;
      node.drift.y -= (node.y - node.home.y) * 0.00004;
      node.drift.z -= (node.z - node.home.z) * 0.00004;
      node.activation *= 0.92;
      pos[i * 3] = node.x;
      pos[i * 3 + 1] = node.y;
      pos[i * 3 + 2] = node.z;
      this.nodeActivations[i] = node.activation;
    }
    this.nodeGeo.attributes.position.needsUpdate = true;
    this.nodeGeo.attributes.aActivation.needsUpdate = true;

    const cam = this.camera.position;
    cam.x += (this.mouse.x * 0.4 - cam.x) * delta * 1.5;
    cam.y += (this.mouse.y * 0.4 - cam.y) * delta * 1.5;
    // During the greeting, dolly the camera in/out for extra sense of movement.
    const baseZ = this.colorCycle ? 9.4 + Math.sin(elapsed * 2.2) * 0.4 : 10;
    cam.z += (baseZ - cam.z) * delta * 2;
    this.camera.lookAt(0, 0, 0);

    if (this.useBloom && this.composer && this.bloomPass) {
      // Brighter bloom as the network energises (peaks during greeting).
      this.bloomPass.strength = 0.42 + this.liveActivity * 0.42;
      this.composer.render();
    } else {
      this.renderer.render(this.scene, this.camera);
    }
  }

  // ─── Public controls ──────────────────────────────────────────────────────
  setState(name: NeuralState) {
    if (!STATE_PROFILES[name]) return;
    this.currentState = name;
    this.target = STATE_PROFILES[name];
    if (name === "thinking") this.seedRandomPulses(this.isMobile ? 6 : 12);
  }

  pulse(count = 1) {
    this.seedRandomPulses(count);
  }

  /**
   * A bright, colorful "hello" burst: max energy, cascading pulses and a sweep
   * through all three brand colors, easing back to idle after ~5s.
   */
  greet(durationMs = 4500) {
    this.colorCycle = true;
    this.currentState = "greeting";
    this.target = STATE_PROFILES.greeting;
    this.seedRandomPulses(this.isMobile ? 18 : 40);
    if (this.greetTimer) clearTimeout(this.greetTimer);
    this.greetTimer = setTimeout(() => {
      this.colorCycle = false;
      this.greetTimer = null;
      this.setState("idle");
    }, durationMs);
  }

  setAmplitude(level: number) {
    this.ampBump = Math.max(0, Math.min(1, level || 0));
  }

  private onResize() {
    if (!this.renderer) return;
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.composer?.setSize(window.innerWidth, window.innerHeight);
    this.bloomPass?.setSize(window.innerWidth, window.innerHeight);
  }

  private onMouseMove(e: MouseEvent) {
    this.mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
    this.mouse.y = -((e.clientY / window.innerHeight) * 2 - 1);
  }

  dispose() {
    if (this.rafId) cancelAnimationFrame(this.rafId);
    if (this.greetTimer) clearTimeout(this.greetTimer);
    window.removeEventListener("resize", this.onResize);
    window.removeEventListener("mousemove", this.onMouseMove);
    this.composer?.dispose();
    if (this.renderer) this.renderer.dispose();
  }
}
