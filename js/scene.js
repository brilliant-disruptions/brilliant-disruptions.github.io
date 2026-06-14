/**
 * scene.js — Three.js particle system
 * Handles: loading animation, BD logo formation, particle field, mouse repulsion
 */

(function () {
  'use strict';

  const isMobile = window.innerWidth < 768;
  const PARTICLE_COUNT = isMobile ? 600 : 2000;
  const MOUSE_REPULSION_RADIUS = isMobile ? 1.5 : 2.2;
  const MOUSE_REPULSION_FORCE = 0.08;
  const DRIFT_SPEED = 0.0004;

  let renderer, scene, camera, points, geometry;
  let positions, colors, sizes;
  let startPositions, bdTargets, fieldTargets, velocities;
  let mouseWorld = { x: 0, y: 0 };
  let phase = 'loading'; // loading | converging | holding | dispersing | field
  let phaseProgress = 0;
  let rafId;
  let clock;

  // ─── Easing helpers ───────────────────────────────────────────────────────
  function easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }
  function easeOutExpo(t) {
    return t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
  }
  function easeOutElastic(t) {
    const c4 = (2 * Math.PI) / 3;
    return t === 0 ? 0 : t === 1 ? 1
      : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
  }
  function lerp(a, b, t) { return a + (b - a) * t; }

  // ─── Sample "BD" text to get logo target positions ────────────────────────
  function getBDPositions(count) {
    const W = 600, H = 260;
    const offscreen = document.createElement('canvas');
    offscreen.width = W;
    offscreen.height = H;
    const ctx = offscreen.getContext('2d');

    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#fff';
    ctx.font = '900 200px Syne, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('BD', W / 2, H / 2);

    const imageData = ctx.getImageData(0, 0, W, H).data;
    const rawPositions = [];

    // Gather all lit pixels
    for (let y = 0; y < H; y += 3) {
      for (let x = 0; x < W; x += 3) {
        const idx = (y * W + x) * 4;
        if (imageData[idx] > 100) {
          rawPositions.push({
            x: (x / W - 0.5) * 10,
            y: -(y / H - 0.5) * 4.5
          });
        }
      }
    }

    // If Syne font not loaded yet, fall back to a basic bold sans-serif attempt
    if (rawPositions.length < 50) {
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#fff';
      ctx.font = '900 200px Arial, sans-serif';
      ctx.fillText('BD', W / 2, H / 2);
      const imgData2 = ctx.getImageData(0, 0, W, H).data;
      for (let y = 0; y < H; y += 3) {
        for (let x = 0; x < W; x += 3) {
          const idx = (y * W + x) * 4;
          if (imgData2[idx] > 100) {
            rawPositions.push({
              x: (x / W - 0.5) * 10,
              y: -(y / H - 0.5) * 4.5
            });
          }
        }
      }
    }

    // If still no positions, make a fallback diamond pattern
    if (rawPositions.length < 20) {
      for (let i = 0; i < 300; i++) {
        const angle = (i / 300) * Math.PI * 2;
        rawPositions.push({
          x: Math.cos(angle) * 3,
          y: Math.sin(angle) * 2
        });
      }
    }

    // Distribute count among found positions
    const targets = [];
    for (let i = 0; i < count; i++) {
      const base = rawPositions[i % rawPositions.length];
      targets.push({
        x: base.x + (Math.random() - 0.5) * 0.12,
        y: base.y + (Math.random() - 0.5) * 0.12,
        z: (Math.random() - 0.5) * 0.6
      });
    }
    return targets;
  }

  // ─── Init Three.js ────────────────────────────────────────────────────────
  function init() {
    const canvas = document.getElementById('bg-canvas');
    if (!canvas || typeof THREE === 'undefined') return;

    clock = new THREE.Clock();

    renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: false,
      powerPreference: 'high-performance'
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setClearColor(0x000000, 0);

    scene = new THREE.Scene();

    camera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    );
    camera.position.z = 5;

    createParticles();
    bindEvents();
    animate();
  }

  // ─── Create particle system ───────────────────────────────────────────────
  function createParticles() {
    const N = PARTICLE_COUNT;

    positions     = new Float32Array(N * 3);
    colors        = new Float32Array(N * 3);
    sizes         = new Float32Array(N);
    startPositions = new Float32Array(N * 3);
    velocities    = [];

    // Compute BD logo targets (do this once at init)
    bdTargets    = getBDPositions(N);
    fieldTargets = [];

    for (let i = 0; i < N; i++) {
      // Start position: random edge (off-screen)
      const edge = Math.floor(Math.random() * 4);
      let sx, sy;
      if (edge === 0)      { sx = -12; sy = (Math.random() - 0.5) * 10; }
      else if (edge === 1) { sx =  12; sy = (Math.random() - 0.5) * 10; }
      else if (edge === 2) { sx = (Math.random() - 0.5) * 20; sy =  7; }
      else                 { sx = (Math.random() - 0.5) * 20; sy = -7; }
      const sz = (Math.random() - 0.5) * 2;

      positions[i * 3]     = sx;
      positions[i * 3 + 1] = sy;
      positions[i * 3 + 2] = sz;
      startPositions[i * 3]     = sx;
      startPositions[i * 3 + 1] = sy;
      startPositions[i * 3 + 2] = sz;

      // Color: mostly cyan with some violet and white variation
      const colorType = Math.random();
      if (colorType < 0.6) {
        colors[i * 3]     = 0.0 + Math.random() * 0.1;
        colors[i * 3 + 1] = 0.85 + Math.random() * 0.15;
        colors[i * 3 + 2] = 0.9 + Math.random() * 0.1;
      } else if (colorType < 0.85) {
        colors[i * 3]     = 0.4 + Math.random() * 0.3;
        colors[i * 3 + 1] = 0.1 + Math.random() * 0.2;
        colors[i * 3 + 2] = 0.9 + Math.random() * 0.1;
      } else {
        colors[i * 3]     = 0.85 + Math.random() * 0.15;
        colors[i * 3 + 1] = 0.85 + Math.random() * 0.15;
        colors[i * 3 + 2] = 1.0;
      }

      sizes[i] = Math.random() * 3.5 + 0.8;

      // Field target: sphere distribution
      const theta = Math.random() * Math.PI * 2;
      const phi   = Math.acos(2 * Math.random() - 1);
      const r     = 3.5 + Math.random() * 4;
      fieldTargets.push({
        x: r * Math.sin(phi) * Math.cos(theta),
        y: r * Math.sin(phi) * Math.sin(theta) * 0.55,
        z: r * Math.cos(phi) * 0.25 - 1.5
      });

      velocities.push({
        x: (Math.random() - 0.5) * DRIFT_SPEED * 1.5,
        y: (Math.random() - 0.5) * DRIFT_SPEED * 1.5,
        z: (Math.random() - 0.5) * DRIFT_SPEED * 0.5
      });
    }

    geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color',    new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('size',     new THREE.BufferAttribute(sizes, 1));

    const material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 }
      },
      vertexShader: `
        attribute float size;
        attribute vec3 color;
        varying vec3 vColor;
        varying float vAlpha;
        uniform float uTime;

        void main() {
          vColor = color;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          float perspSize = size * (280.0 / -mvPosition.z);
          gl_PointSize = perspSize;
          // Subtle pulse per particle based on position hash
          float pulse = sin(uTime * 1.5 + position.x * 3.7 + position.y * 2.1) * 0.3 + 0.7;
          vAlpha = pulse;
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        varying float vAlpha;

        void main() {
          vec2 uv = gl_PointCoord - vec2(0.5);
          float d = length(uv);
          if (d > 0.5) discard;

          // Soft glow: bright core, fade out
          float core  = 1.0 - smoothstep(0.0, 0.15, d);
          float glow  = 1.0 - smoothstep(0.1, 0.5, d);
          float alpha = (core * 0.9 + glow * 0.5) * vAlpha;

          gl_FragColor = vec4(vColor, alpha);
        }
      `,
      transparent: true,
      vertexColors: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });

    points = new THREE.Points(geometry, material);
    scene.add(points);
  }

  // ─── Animate loop ─────────────────────────────────────────────────────────
  function animate() {
    rafId = requestAnimationFrame(animate);
    const delta = clock.getDelta();
    const elapsed = clock.getElapsedTime();

    if (points) {
      points.material.uniforms.uTime.value = elapsed;
    }

    const pos = geometry.attributes.position.array;
    const N = PARTICLE_COUNT;

    // Phase state machine
    if (phase === 'converging') {
      phaseProgress = Math.min(phaseProgress + delta * 0.7, 1);
      const t = easeInOutCubic(phaseProgress);

      for (let i = 0; i < N; i++) {
        const sx = startPositions[i * 3];
        const sy = startPositions[i * 3 + 1];
        const sz = startPositions[i * 3 + 2];
        const tx = bdTargets[i].x;
        const ty = bdTargets[i].y;
        const tz = bdTargets[i].z;
        pos[i * 3]     = lerp(sx, tx, t);
        pos[i * 3 + 1] = lerp(sy, ty, t);
        pos[i * 3 + 2] = lerp(sz, tz, t);
      }

      if (phaseProgress >= 1) {
        phase = 'holding';
        phaseProgress = 0;
        setTimeout(startDispersal, 700);
      }
    } else if (phase === 'dispersing') {
      phaseProgress = Math.min(phaseProgress + delta * 0.75, 1);
      const t = easeOutExpo(phaseProgress);

      for (let i = 0; i < N; i++) {
        const bx = bdTargets[i].x;
        const by = bdTargets[i].y;
        const bz = bdTargets[i].z;
        const fx = fieldTargets[i].x;
        const fy = fieldTargets[i].y;
        const fz = fieldTargets[i].z;
        pos[i * 3]     = lerp(bx, fx, t);
        pos[i * 3 + 1] = lerp(by, fy, t);
        pos[i * 3 + 2] = lerp(bz, fz, t);
      }

      if (phaseProgress >= 1) {
        phase = 'field';
        // Set current as "start" for drift
        for (let i = 0; i < N * 3; i++) {
          startPositions[i] = pos[i];
        }
      }
    } else if (phase === 'field') {
      // Organic drift + mouse repulsion
      for (let i = 0; i < N; i++) {
        const i3 = i * 3;
        pos[i3]     += velocities[i].x;
        pos[i3 + 1] += velocities[i].y;
        pos[i3 + 2] += velocities[i].z;

        // Soft boundary: push back toward sphere
        const ft = fieldTargets[i];
        const bx = pos[i3] - ft.x;
        const by = pos[i3 + 1] - ft.y;
        const dist = Math.sqrt(bx * bx + by * by);
        if (dist > 1.5) {
          velocities[i].x -= bx * 0.00003;
          velocities[i].y -= by * 0.00003;
        }

        // Mouse repulsion (only on z~0 plane approximation)
        const mx = pos[i3] - mouseWorld.x;
        const my = pos[i3 + 1] - mouseWorld.y;
        const md = Math.sqrt(mx * mx + my * my);
        if (md < MOUSE_REPULSION_RADIUS && md > 0.01) {
          const force = (1 - md / MOUSE_REPULSION_RADIUS) * MOUSE_REPULSION_FORCE;
          velocities[i].x += (mx / md) * force;
          velocities[i].y += (my / md) * force;
        }

        // Speed limit
        const speed = Math.sqrt(
          velocities[i].x * velocities[i].x + velocities[i].y * velocities[i].y
        );
        const maxSpeed = 0.012;
        if (speed > maxSpeed) {
          velocities[i].x = (velocities[i].x / speed) * maxSpeed;
          velocities[i].y = (velocities[i].y / speed) * maxSpeed;
        }

        // Damping
        velocities[i].x *= 0.995;
        velocities[i].y *= 0.995;
        velocities[i].z *= 0.998;
      }
    }

    geometry.attributes.position.needsUpdate = true;
    renderer.render(scene, camera);
  }

  // ─── Phase transitions ────────────────────────────────────────────────────
  function startConverging() {
    phase = 'converging';
    phaseProgress = 0;
  }

  function startDispersal() {
    phase = 'dispersing';
    phaseProgress = 0;
    // Trigger loader fade
    const loader = document.getElementById('loader');
    if (loader) loader.classList.add('loaded');
    // Trigger hero reveal
    window.dispatchEvent(new CustomEvent('scene:dispersed'));
  }

  // Public API consumed by main.js
  window.SceneAPI = { startConverging };

  // ─── Events ───────────────────────────────────────────────────────────────
  function bindEvents() {
    window.addEventListener('resize', onResize);
    window.addEventListener('mousemove', onMouseMove);
  }

  function onResize() {
    if (!renderer) return;
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  }

  function onMouseMove(e) {
    // Convert screen coords to approximate world coords at z=0
    const nx = (e.clientX / window.innerWidth) * 2 - 1;
    const ny = -((e.clientY / window.innerHeight) * 2 - 1);
    const vFOV = camera.fov * Math.PI / 180;
    const h = 2 * Math.tan(vFOV / 2) * camera.position.z;
    const w = h * camera.aspect;
    mouseWorld.x = nx * w / 2;
    mouseWorld.y = ny * h / 2;
  }

  // ─── Bootstrap ────────────────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
