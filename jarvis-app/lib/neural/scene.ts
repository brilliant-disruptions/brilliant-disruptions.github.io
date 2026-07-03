/**
 * NeuralScene — the JARVIS "magma core" for the Neural tab.
 *
 * A molten noise-displaced core sphere wrapped in ~1200 bezier energy veins
 * that pulse inward toward the core, with a dust field, bloom
 * post-processing and orbit controls. Ported from
 * https://codepen.io/VoXelo/pen/RNGRQBo and made voice-reactive: the page
 * feeds a speech envelope via setVoiceLevel()/pulse() and the core visibly
 * swells with each word JARVIS speaks.
 *
 * Framework-agnostic: construct with a <canvas>, call init(), drive with
 * setVoiceLevel()/pulse()/greet()/setTheme(), and dispose() on unmount.
 * Used by the React page at app/(app)/neural/page.tsx.
 */

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { THEMES } from "./themes";
import { FlareField } from "./flares";

const CORE_RADIUS = 2.2;
const OUTER_RADIUS = 10.0;
const POINTS_PER_VEIN = 45;
const THEME_LERP = 0.05; // per-frame color convergence, as in the pen

// Ashima simplex noise, verbatim from the pen.
const snoise3GLSL = `
  vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 permute(vec4 x) { return mod289(((x*34.0)+1.0)*x); }
  vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

  float snoise(vec3 v) {
    const vec2  C = vec2(1.0/6.0, 1.0/3.0) ;
    const vec4  D = vec4(0.0, 0.5, 1.0, 2.0);
    vec3 i  = floor(v + dot(v, C.yyy) );
    vec3 x0 = v - i + dot(i, C.xxx) ;
    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min( g.xyz, l.zxy );
    vec3 i2 = max( g.xyz, l.zxy );
    vec3 x1 = x0 - i1 + C.xxx;
    vec3 x2 = x0 - i2 + C.yyy;
    vec3 x3 = x0 - D.yyy;
    i = mod289(i);
    vec4 p = permute( permute( permute( i.z + vec4(0.0, i1.z, i2.z, 1.0 )) + i.y + vec4(0.0, i1.y, i2.y, 1.0 )) + i.x + vec4(0.0, i1.x, i2.x, 1.0 ));
    float n_ = 0.142857142857;
    vec3  ns = n_ * D.wyz - D.xzx;
    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_ );
    vec4 x = x_ *ns.x + ns.yyyy;
    vec4 y = y_ *ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);
    vec4 b0 = vec4( x.xy, y.xy );
    vec4 b1 = vec4( x.zw, y.zw );
    vec4 s0 = floor(b0)*2.0 + 1.0;
    vec4 s1 = floor(b1)*2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));
    vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy ;
    vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww ;
    vec3 p0 = vec3(a0.xy,h.x);
    vec3 p1 = vec3(a0.zw,h.y);
    vec3 p2 = vec3(a1.xy,h.z);
    vec3 p3 = vec3(a1.zw,h.w);
    vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2, p2), dot(p3,p3)));
    p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
    vec4 m = max(0.5 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
    m = m * m;
    return 42.0 * dot( m*m, vec4( dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3) ) );
  }
`;

function randomPointOnSphere(radius: number): THREE.Vector3 {
  const u = Math.random();
  const v = Math.random();
  const theta = 2 * Math.PI * u;
  const phi = Math.acos(2 * v - 1);
  return new THREE.Vector3(
    radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.sin(phi) * Math.sin(theta),
    radius * Math.cos(phi),
  );
}

export class NeuralScene {
  private canvas: HTMLCanvasElement;
  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private clock!: THREE.Clock;
  private composer!: EffectComposer;
  private bloomPass!: UnrealBloomPass;
  private controls!: OrbitControls;
  private mainGroup!: THREE.Group;
  private dustMesh!: THREE.Points;
  private dustMat!: THREE.PointsMaterial;
  private rafId = 0;
  private supported = true;
  private flares: FlareField | null = null;

  private themeIndex = 0;
  private voiceLevel = 0;
  private voiceTarget = 0;
  private pulseLevel = 0;
  private greetLevel = 0;

  private readonly isMobile: boolean;
  private readonly NUM_VEINS: number;
  private readonly DUST_COUNT: number;
  private readonly reduceMotion: boolean;

  // Shared across core / vein materials.
  private uniforms = {
    time: { value: 0 },
    uVoice: { value: 0 },
    uPulse: { value: 0 },
    cDark: { value: THEMES[0].core[0].clone() },
    cRed: { value: THEMES[0].core[1].clone() },
    cOrange: { value: THEMES[0].core[2].clone() },
    cYellow: { value: THEMES[0].core[3].clone() },
    cSurface: { value: THEMES[0].vein.surface.clone() },
    cCoreA: { value: THEMES[0].vein.coreA.clone() },
    cCoreB: { value: THEMES[0].vein.coreB.clone() },
  };

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.isMobile = typeof window !== "undefined" && window.innerWidth < 768;
    this.NUM_VEINS = this.isMobile ? 600 : 1200;
    this.DUST_COUNT = this.isMobile ? 1000 : 2000;
    this.reduceMotion =
      typeof window !== "undefined" &&
      !!window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.onResize = this.onResize.bind(this);
    this.animate = this.animate.bind(this);
  }

  isSupported() {
    return this.supported;
  }

  init(): boolean {
    const hasWebGL = (() => {
      try {
        const probe = document.createElement("canvas");
        return !!(
          window.WebGLRenderingContext &&
          (probe.getContext("webgl") || probe.getContext("experimental-webgl"))
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
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
    });
    const dpr = Math.min(window.devicePixelRatio, 2);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(window.innerWidth, window.innerHeight);

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(THEMES[0].bg.getHex(), 0.012);
    this.renderer.setClearColor(this.scene.fog.color);

    this.camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
    this.camera.position.set(15, 10, 25);

    this.composer = new EffectComposer(this.renderer);
    this.composer.setPixelRatio(dpr);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      2.0, // strength
      0.5, // radius
      0.85, // threshold
    );
    this.composer.addPass(this.bloomPass);

    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.autoRotate = true;
    this.controls.autoRotateSpeed = 0.8;
    this.controls.maxDistance = 50;
    this.controls.minDistance = 12;
    if (this.reduceMotion) this.controls.autoRotate = false;

    this.mainGroup = new THREE.Group();
    this.scene.add(this.mainGroup);

    this.buildDust();
    this.buildCore();
    this.buildVeins();
    this.buildHalo();
    this.buildStars();
    this.buildNebula();
    this.flares = new FlareField(CORE_RADIUS, this.uniforms, this.isMobile ? 14 : 28);
    this.mainGroup.add(this.flares.mesh);

    window.addEventListener("resize", this.onResize);
    this.animate();
    return true;
  }

  // ─── Dust field ────────────────────────────────────────────────────────────
  private buildDust() {
    const positions = new Float32Array(this.DUST_COUNT * 3);
    for (let i = 0; i < positions.length; i++) positions[i] = (Math.random() - 0.5) * 100;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    this.dustMat = new THREE.PointsMaterial({
      color: THEMES[0].dust.clone(),
      size: 0.1,
      transparent: true,
      opacity: 0.3,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.dustMesh = new THREE.Points(geo, this.dustMat);
    this.scene.add(this.dustMesh);
  }

  // ─── Molten core ───────────────────────────────────────────────────────────
  private buildCore() {
    const geo = new THREE.SphereGeometry(CORE_RADIUS, 128, 128);
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: `
        uniform float time;
        uniform float uVoice;
        varying vec3 vPosition;
        varying vec3 vNormal;
        ${snoise3GLSL}
        void main() {
          vPosition = position;
          vNormal = normal;
          // Voice swells the surface: displacement grows from the pen's 0.15
          // up to ~0.45 while JARVIS speaks.
          float amp = 0.15 + uVoice * 0.85;
          float displacement = snoise(position * 1.8 + time * 0.4) * amp;
          vec3 newPosition = position + normal * displacement;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(newPosition, 1.0);
        }
      `,
      fragmentShader: `
        uniform float time;
        uniform float uVoice;
        uniform float uPulse;
        uniform vec3 cDark;
        uniform vec3 cRed;
        uniform vec3 cOrange;
        uniform vec3 cYellow;
        varying vec3 vPosition;
        varying vec3 vNormal;
        ${snoise3GLSL}
        void main() {
          float n1 = snoise(vPosition * 1.5 - time * 0.5);
          float n2 = snoise(vPosition * 4.0 + time * 0.3);
          float noiseVal = n1 * 0.6 + n2 * 0.4;

          vec3 color;
          if (noiseVal < -0.1) {
            color = mix(cDark, cRed, smoothstep(-0.5, -0.1, noiseVal));
          } else if (noiseVal < 0.3) {
            color = mix(cRed, cOrange, smoothstep(-0.1, 0.3, noiseVal));
          } else {
            color = mix(cOrange, cYellow, smoothstep(0.3, 0.8, noiseVal));
          }

          float fresnel = dot(vNormal, vec3(0.0, 0.0, 1.0));
          fresnel = clamp(1.0 - fresnel, 0.0, 1.0);
          color += cOrange * pow(fresnel, 2.0) * 0.8;

          // Glow boost while speaking / pulsing.
          color *= 1.5 + uVoice * 2.6 + uPulse * 1.2;

          gl_FragColor = vec4(color, 1.0);
        }
      `,
    });
    this.mainGroup.add(new THREE.Mesh(geo, mat));
  }

  // ─── Energy veins ──────────────────────────────────────────────────────────
  private buildVeins() {
    const positions: number[] = [];
    const progress: number[] = [];
    const offsets: number[] = [];
    const rands: number[] = [];

    for (let i = 0; i < this.NUM_VEINS; i++) {
      const start = randomPointOnSphere(OUTER_RADIUS);
      const end = start.clone().normalize().multiplyScalar(CORE_RADIUS * 0.85);

      const mid = new THREE.Vector3().lerpVectors(start, end, 0.5);
      mid.normalize().multiplyScalar(OUTER_RADIUS * 0.55);
      const tangent = new THREE.Vector3().crossVectors(start, new THREE.Vector3(0, 1, 0)).normalize();
      const bitangent = new THREE.Vector3().crossVectors(start, tangent).normalize();
      mid.add(tangent.multiplyScalar((Math.random() - 0.5) * 6));
      mid.add(bitangent.multiplyScalar((Math.random() - 0.5) * 6));

      const curve = new THREE.QuadraticBezierCurve3(start, mid, end);
      const points = curve.getPoints(POINTS_PER_VEIN); // returns POINTS_PER_VEIN + 1 points
      const offset = Math.random();
      const rand = Math.random();

      for (let j = 0; j < POINTS_PER_VEIN; j++) {
        positions.push(points[j].x, points[j].y, points[j].z);
        positions.push(points[j + 1].x, points[j + 1].y, points[j + 1].z);
        progress.push(j / POINTS_PER_VEIN, (j + 1) / POINTS_PER_VEIN);
        offsets.push(offset, offset);
        rands.push(rand, rand);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute("progress", new THREE.Float32BufferAttribute(progress, 1));
    geo.setAttribute("offset", new THREE.Float32BufferAttribute(offsets, 1));
    geo.setAttribute("randomSeed", new THREE.Float32BufferAttribute(rands, 1));

    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: `
        attribute float progress;
        attribute float offset;
        attribute float randomSeed;
        varying float vProgress;
        varying float vOffset;
        varying float vRandom;
        void main() {
          vProgress = progress;
          vOffset = offset;
          vRandom = randomSeed;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float time;
        uniform float uPulse;
        uniform vec3 cSurface;
        uniform vec3 cCoreA;
        uniform vec3 cCoreB;
        varying float vProgress;
        varying float vOffset;
        varying float vRandom;
        void main() {
          vec3 targetCoreColor = mix(cCoreA, cCoreB, vRandom);
          vec3 color = mix(cSurface, targetCoreColor, pow(vProgress, 1.5));

          float speed = 0.3;
          float phase = vProgress - time * speed + vOffset * 10.0;
          float flow = fract(phase);
          float pulse = exp(-flow * 10.0);

          // uPulse brightens the traveling heads on each spoken word.
          vec3 pulseGlow = color * pulse * (10.0 + uPulse * 42.0);
          color += pulseGlow;

          float alphaBase = 0.02;
          float alphaPulse = pulse * (0.9 + uPulse * 1.3);
          float alpha = alphaBase + alphaPulse;

          alpha *= smoothstep(0.0, 0.05, vProgress) * smoothstep(1.0, 0.8, vProgress);

          gl_FragColor = vec4(color, alpha);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.mainGroup.add(new THREE.LineSegments(geo, mat));
  }

  // ─── Boundary halo ─────────────────────────────────────────────────────────
  // A fresnel-rim sphere at the vein-origin radius: invisible face-on, a soft
  // luminous limb at the edges, so the veins read as born from an energy field.
  // Tinted by cSurface, so theme switches cross-fade it for free.
  private buildHalo() {
    const geo = new THREE.SphereGeometry(OUTER_RADIUS * 0.995, 64, 64);
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: `
        varying vec3 vNormal;
        void main() {
          vNormal = normalize(normalMatrix * normal);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 cSurface;
        varying vec3 vNormal;
        void main() {
          float fresnel = pow(1.0 - abs(dot(vNormal, vec3(0.0, 0.0, 1.0))), 3.5);
          vec3 color = cSurface * fresnel * 1.6;
          float alpha = fresnel * 0.35;
          gl_FragColor = vec4(color, alpha);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.mainGroup.add(new THREE.Mesh(geo, mat));
  }

  // ─── Space backdrop: distant starfield ─────────────────────────────────────
  // Far outside the fog's reach by construction (ShaderMaterials ignore fog).
  // Added to the scene root, not mainGroup, so it reads as a fixed sky.
  private buildStars() {
    const COUNT = this.isMobile ? 1200 : 2500;
    const positions = new Float32Array(COUNT * 3);
    const sizes = new Float32Array(COUNT);
    const seeds = new Float32Array(COUNT);
    const colors = new Float32Array(COUNT * 3);
    const white = new THREE.Color(0xffffff);
    const cool = new THREE.Color(0xbfd4ff);
    const warm = new THREE.Color(0xffe0b8);
    for (let i = 0; i < COUNT; i++) {
      const dir = new THREE.Vector3(
        Math.random() * 2 - 1,
        Math.random() * 2 - 1,
        Math.random() * 2 - 1,
      ).normalize();
      const r = 220 + Math.random() * 200;
      positions[i * 3] = dir.x * r;
      positions[i * 3 + 1] = dir.y * r;
      positions[i * 3 + 2] = dir.z * r;
      sizes[i] = 0.6 + Math.random() * 1.6;
      seeds[i] = Math.random();
      const t = Math.random();
      const c = t < 0.85 ? white : t < 0.95 ? cool : warm;
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("size", new THREE.BufferAttribute(sizes, 1));
    geo.setAttribute("seed", new THREE.BufferAttribute(seeds, 1));
    geo.setAttribute("aColor", new THREE.BufferAttribute(colors, 3));
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: `
        attribute float size;
        attribute float seed;
        attribute vec3 aColor;
        uniform float time;
        varying vec3 vColor;
        varying float vTwinkle;
        void main() {
          vColor = aColor;
          vTwinkle = 0.75 + 0.25 * sin(time * (0.5 + seed) + seed * 40.0);
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * (600.0 / -mvPosition.z);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        varying float vTwinkle;
        void main() {
          vec2 uv = gl_PointCoord - vec2(0.5);
          float d = length(uv);
          if (d > 0.5) discard;
          float falloff = 1.0 - smoothstep(0.0, 0.5, d);
          gl_FragColor = vec4(vColor * vTwinkle, falloff * vTwinkle);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.scene.add(new THREE.Points(geo, mat));
  }

  // ─── Space backdrop: faint theme-tinted nebula haze ────────────────────────
  private buildNebula() {
    const geo = new THREE.SphereGeometry(500, 32, 32);
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float time;
        uniform vec3 cSurface;
        varying vec3 vDir;
        ${snoise3GLSL}
        void main() {
          float n = snoise(vDir * 2.0 + time * 0.01) * 0.6
                  + snoise(vDir * 5.0 - time * 0.01) * 0.4;
          n = max(0.0, n);
          vec3 color = cSurface * n * 0.16;
          gl_FragColor = vec4(color, n * 0.14);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = -1;
    this.scene.add(mesh);
  }

  // ─── Animate ──────────────────────────────────────────────────────────────
  private animate() {
    this.rafId = requestAnimationFrame(this.animate);
    if (typeof document !== "undefined" && document.hidden) return;
    const delta = Math.min(this.clock.getDelta(), 0.05);
    this.uniforms.time.value = this.clock.getElapsedTime();

    // Envelopes: voice chases its target fast; word pulses decay quickly;
    // the greet surge decays over ~4.5s (matches the page's active window).
    this.voiceLevel += (this.voiceTarget - this.voiceLevel) * Math.min(1, delta * 14);
    this.pulseLevel *= Math.exp(-2.8 * delta);
    this.greetLevel *= Math.exp(-0.8 * delta);
    this.uniforms.uVoice.value = Math.min(1, this.voiceLevel + this.greetLevel * 0.5);
    this.uniforms.uPulse.value = Math.min(1.5, this.pulseLevel + this.greetLevel);

    // Cross-fade every color channel toward the active theme (pen behavior).
    const tgt = THEMES[this.themeIndex];
    this.uniforms.cDark.value.lerp(tgt.core[0], THEME_LERP);
    this.uniforms.cRed.value.lerp(tgt.core[1], THEME_LERP);
    this.uniforms.cOrange.value.lerp(tgt.core[2], THEME_LERP);
    this.uniforms.cYellow.value.lerp(tgt.core[3], THEME_LERP);
    this.uniforms.cSurface.value.lerp(tgt.vein.surface, THEME_LERP);
    this.uniforms.cCoreA.value.lerp(tgt.vein.coreA, THEME_LERP);
    this.uniforms.cCoreB.value.lerp(tgt.vein.coreB, THEME_LERP);
    this.dustMat.color.lerp(tgt.dust, THEME_LERP);
    (this.scene.fog as THREE.FogExp2).color.lerp(tgt.bg, THEME_LERP);
    this.renderer.setClearColor((this.scene.fog as THREE.FogExp2).color);

    this.bloomPass.strength = 2.0 + this.greetLevel * 1.2 + this.uniforms.uVoice.value * 1.4;
    if (!this.reduceMotion) this.controls.autoRotateSpeed = 0.8 + this.greetLevel * 2.0;

    this.dustMesh.rotation.y += 0.02 * delta;
    this.flares?.update(delta);
    this.controls.update();
    this.composer.render();
  }

  // ─── Public controls ──────────────────────────────────────────────────────
  /** Word-boundary punch: brightens vein pulse heads and the core. */
  pulse(count = 1) {
    this.pulseLevel = Math.min(1.5, this.pulseLevel + 0.4 * count);
    if (!this.reduceMotion) this.flares?.activate(2 + Math.floor(Math.random() * 2));
  }

  /** Drive the core's voice swell (0..1). Page feeds a speech envelope here. */
  setVoiceLevel(level: number) {
    this.voiceTarget = Math.max(0, Math.min(1, level || 0));
  }

  /** Greeting surge: bloom + rotation + vein/core boost, decaying over ~4.5s. */
  greet() {
    this.greetLevel = 1;
    if (!this.reduceMotion) this.flares?.activate(8);
  }

  /** Set the active palette; colors cross-fade toward it each frame. */
  setTheme(index: number) {
    this.themeIndex = Math.max(0, Math.min(THEMES.length - 1, Math.floor(index)));
  }

  private onResize() {
    if (!this.renderer) return;
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.composer.setSize(window.innerWidth, window.innerHeight);
  }

  dispose() {
    if (this.rafId) cancelAnimationFrame(this.rafId);
    window.removeEventListener("resize", this.onResize);
    this.controls?.dispose();
    this.scene?.traverse((obj) => {
      const o = obj as THREE.Object3D & {
        geometry?: THREE.BufferGeometry;
        material?: THREE.Material | THREE.Material[];
      };
      o.geometry?.dispose();
      if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
      else o.material?.dispose();
    });
    this.bloomPass?.dispose();
    this.composer?.dispose();
    if (this.renderer) this.renderer.dispose();
  }
}
