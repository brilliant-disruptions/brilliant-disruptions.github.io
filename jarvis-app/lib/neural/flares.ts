/**
 * FlareField — pooled solar-prominence arcs for the JARVIS magma core.
 *
 * A fixed pool of bezier arcs anchored on the core surface, all drawn as one
 * LineSegments mesh. Idle arcs are invisible (life 0). activate(n) erupts up
 * to n idle arcs at fresh random spots; update(delta) decays their lives. A
 * bright head glow travels along each arc as it dies, tinted by the scene's
 * shared cOrange/cYellow uniforms so theme switches re-tint eruptions for
 * free. Construction is pure CPU math (no WebGL context until rendered), so
 * the eruption lifecycle is unit-testable headless.
 */

import * as THREE from "three";

export type FlareUniforms = {
  time: { value: number };
  cOrange: { value: THREE.Color };
  cYellow: { value: THREE.Color };
};

const SEGMENTS = 16; // line segments per arc → SEGMENTS * 2 vertices

export class FlareField {
  readonly mesh: THREE.LineSegments;
  private readonly coreRadius: number;
  private readonly count: number;
  private readonly lives: Float32Array; // 1 → just erupted, 0 → idle
  private readonly durations: Float32Array; // seconds per eruption
  private readonly positions: Float32Array;
  private readonly lifeAttr: Float32Array;
  private readonly geometry: THREE.BufferGeometry;

  constructor(coreRadius: number, uniforms: FlareUniforms, count: number) {
    this.coreRadius = coreRadius;
    this.count = count;
    this.lives = new Float32Array(count);
    this.durations = new Float32Array(count).fill(0.6);

    const vertsPerArc = SEGMENTS * 2;
    this.positions = new Float32Array(count * vertsPerArc * 3);
    this.lifeAttr = new Float32Array(count * vertsPerArc);
    const progress = new Float32Array(count * vertsPerArc);
    for (let a = 0; a < count; a++) {
      for (let s = 0; s < SEGMENTS; s++) {
        const i = a * vertsPerArc + s * 2;
        progress[i] = s / SEGMENTS;
        progress[i + 1] = (s + 1) / SEGMENTS;
      }
    }

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute("aProgress", new THREE.BufferAttribute(progress, 1));
    this.geometry.setAttribute("aLife", new THREE.BufferAttribute(this.lifeAttr, 1));

    const material = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: `
        attribute float aProgress;
        attribute float aLife;
        varying float vProgress;
        varying float vLife;
        void main() {
          vProgress = aProgress;
          vLife = aLife;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 cOrange;
        uniform vec3 cYellow;
        varying float vProgress;
        varying float vLife;
        void main() {
          if (vLife <= 0.0) discard;
          vec3 color = mix(cOrange, cYellow, vProgress);
          // A bright head races A→B as the arc dies; HDR gain feeds bloom.
          float head = exp(-abs(vProgress - (1.0 - vLife)) * 5.0);
          float envelope = pow(vLife, 0.6);
          color *= (0.35 + head * 2.2) * envelope * 3.0;
          float alpha = envelope * (0.25 + head * 0.75);
          gl_FragColor = vec4(color, alpha);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    this.mesh = new THREE.LineSegments(this.geometry, material);
    this.mesh.frustumCulled = false; // arc positions rewrite per eruption; skip stale-bounds culling
  }

  /** Number of arcs currently erupting (life > 0). */
  activeCount(): number {
    let n = 0;
    for (let a = 0; a < this.count; a++) if (this.lives[a] > 0) n++;
    return n;
  }

  /** Erupt up to n idle arcs at fresh random positions on the core. */
  activate(n: number) {
    let remaining = n;
    for (let a = 0; a < this.count && remaining > 0; a++) {
      if (this.lives[a] > 0) continue;
      this.regenerateArc(a);
      this.lives[a] = 1;
      this.durations[a] = 0.5 + Math.random() * 0.3;
      remaining--;
    }
  }

  /** Decay eruption lives and push them into the vertex buffer. */
  update(delta: number) {
    const vertsPerArc = SEGMENTS * 2;
    let dirty = false;
    for (let a = 0; a < this.count; a++) {
      if (this.lives[a] <= 0) continue;
      this.lives[a] = Math.max(0, this.lives[a] - delta / this.durations[a]);
      this.lifeAttr.fill(this.lives[a], a * vertsPerArc, (a + 1) * vertsPerArc);
      dirty = true;
    }
    if (dirty) this.geometry.attributes.aLife.needsUpdate = true;
  }

  private regenerateArc(a: number) {
    const dirA = randomUnitVector();
    // Rotate dirA by 25–60° around a random perpendicular axis to get B.
    const axis = new THREE.Vector3().crossVectors(dirA, randomUnitVector()).normalize();
    const angle = (25 + Math.random() * 35) * (Math.PI / 180);
    const dirB = dirA.clone().applyAxisAngle(axis, angle);

    const A = dirA.multiplyScalar(this.coreRadius);
    const B = dirB.multiplyScalar(this.coreRadius);
    const apex = A.clone()
      .add(B)
      .normalize()
      .multiplyScalar(this.coreRadius * (1.6 + Math.random() * 0.8));
    const points = new THREE.QuadraticBezierCurve3(A, apex, B).getPoints(SEGMENTS);

    const vertsPerArc = SEGMENTS * 2;
    for (let s = 0; s < SEGMENTS; s++) {
      const i = (a * vertsPerArc + s * 2) * 3;
      this.positions[i] = points[s].x;
      this.positions[i + 1] = points[s].y;
      this.positions[i + 2] = points[s].z;
      this.positions[i + 3] = points[s + 1].x;
      this.positions[i + 4] = points[s + 1].y;
      this.positions[i + 5] = points[s + 1].z;
    }
    this.geometry.attributes.position.needsUpdate = true;
  }
}

function randomUnitVector(): THREE.Vector3 {
  const u = Math.random();
  const v = Math.random();
  const theta = 2 * Math.PI * u;
  const phi = Math.acos(2 * v - 1);
  return new THREE.Vector3(
    Math.sin(phi) * Math.cos(theta),
    Math.sin(phi) * Math.sin(theta),
    Math.cos(phi),
  );
}
