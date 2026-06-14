/**
 * main.js — Orchestration: loading sequence, sound, section init
 */

(function () {
  'use strict';

  // ─── Loading sequence ─────────────────────────────────────────────────────
  const LOADING_DURATION = 2400; // ms before scene starts converging
  let loadingStarted = false;

  function runLoader() {
    const bar = document.getElementById('loader-bar');
    const loader = document.getElementById('loader');
    if (!loader) { triggerHeroReveal(); return; }

    let progress = 0;
    const increment = 100 / (LOADING_DURATION / 30);

    const interval = setInterval(() => {
      progress = Math.min(progress + increment * (0.8 + Math.random() * 0.4), 95);
      if (bar) bar.style.width = progress + '%';
    }, 30);

    // After full duration, complete the bar and kick off the scene animation
    setTimeout(() => {
      clearInterval(interval);
      if (bar) bar.style.width = '100%';

      // Signal scene to converge particles into BD logo
      setTimeout(() => {
        if (window.SceneAPI) {
          window.SceneAPI.startConverging();
        } else {
          // No Three.js support — just fade out loader
          if (loader) loader.classList.add('loaded');
          triggerHeroReveal();
        }
      }, 300);
    }, LOADING_DURATION);
  }

  // Called by scene.js when dispersion animation completes
  window.addEventListener('scene:dispersed', triggerHeroReveal);

  function triggerHeroReveal() {
    if (window.AnimationsAPI) {
      window.AnimationsAPI.revealHero();
    }
  }

  // ─── Sound system (Web Audio API — no file needed) ────────────────────────
  let audioCtx = null;
  let masterGain = null;
  let drones = [];
  let soundActive = false;

  function initAudio() {
    if (audioCtx) return;
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = audioCtx.createGain();
    masterGain.gain.setValueAtTime(0, audioCtx.currentTime);
    masterGain.connect(audioCtx.destination);

    // Low ambient drone: two detuned oscillators + reverb-like convolver
    const freqs = [55, 55.3, 110, 165.5]; // A1, slightly detuned, A2, E3
    freqs.forEach((freq, i) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      const filter = audioCtx.createBiquadFilter();

      osc.type = i < 2 ? 'sine' : 'triangle';
      osc.frequency.setValueAtTime(freq, audioCtx.currentTime);

      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(400 + i * 80, audioCtx.currentTime);
      filter.Q.setValueAtTime(0.8, audioCtx.currentTime);

      gain.gain.setValueAtTime(
        i === 0 ? 0.25 : i === 1 ? 0.15 : i === 2 ? 0.08 : 0.04,
        audioCtx.currentTime
      );

      // Slow tremolo
      const lfo = audioCtx.createOscillator();
      const lfoGain = audioCtx.createGain();
      lfo.frequency.setValueAtTime(0.15 + i * 0.05, audioCtx.currentTime);
      lfoGain.gain.setValueAtTime(0.06, audioCtx.currentTime);
      lfo.connect(lfoGain);
      lfoGain.connect(gain.gain);
      lfo.start();

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(masterGain);
      osc.start();

      drones.push(osc);
    });
  }

  function enableSound() {
    initAudio();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    masterGain.gain.cancelScheduledValues(audioCtx.currentTime);
    masterGain.gain.linearRampToValueAtTime(0.4, audioCtx.currentTime + 2);
    soundActive = true;
  }

  function disableSound() {
    if (!audioCtx) return;
    masterGain.gain.cancelScheduledValues(audioCtx.currentTime);
    masterGain.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 1.5);
    soundActive = false;
  }

  function initSoundToggle() {
    const btn = document.getElementById('sound-toggle');
    const onIcon  = document.getElementById('sound-on-icon');
    const offIcon = document.getElementById('sound-off-icon');
    if (!btn) return;

    btn.addEventListener('click', () => {
      if (soundActive) {
        disableSound();
        btn.classList.remove('active');
        if (onIcon)  onIcon.style.display  = 'none';
        if (offIcon) offIcon.style.display = 'block';
        btn.setAttribute('aria-label', 'Enable ambient sound');
      } else {
        enableSound();
        btn.classList.add('active');
        if (onIcon)  onIcon.style.display  = 'block';
        if (offIcon) offIcon.style.display = 'none';
        btn.setAttribute('aria-label', 'Disable ambient sound');
      }
    });
  }

  // ─── Smooth scroll for anchor links ──────────────────────────────────────
  function initSmoothScroll() {
    document.querySelectorAll('a[href^="#"]').forEach(link => {
      link.addEventListener('click', (e) => {
        const id = link.getAttribute('href').slice(1);
        const target = document.getElementById(id);
        if (!target) return;
        e.preventDefault();
        const offset = 72; // nav height
        const top = target.getBoundingClientRect().top + window.scrollY - offset;
        window.scrollTo({ top, behavior: 'smooth' });
      });
    });
  }

  // ─── Bootstrap ────────────────────────────────────────────────────────────
  function boot() {
    // Respect reduced motion preference
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const loader = document.getElementById('loader');
      if (loader) loader.classList.add('loaded');
      if (window.AnimationsAPI) window.AnimationsAPI.revealHero();
      if (window.AnimationsAPI) window.AnimationsAPI.initAll();
      return;
    }

    runLoader();
    initSoundToggle();
    initSmoothScroll();

    // Init animations after a short frame (let DOM settle)
    requestAnimationFrame(() => {
      if (window.AnimationsAPI) {
        window.AnimationsAPI.initAll();
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
