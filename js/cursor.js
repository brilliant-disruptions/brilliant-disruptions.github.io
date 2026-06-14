/**
 * cursor.js — Custom cursor ring + particle trail
 */

(function () {
  'use strict';

  // Skip on touch devices
  if (window.matchMedia('(pointer: coarse)').matches) return;

  const cursor = document.getElementById('cursor');
  const ring   = document.getElementById('cursor-ring');
  const trail  = document.getElementById('cursor-trail');
  if (!cursor || !ring || !trail) return;

  const TRAIL_LENGTH = 8;
  const TRAIL_INTERVAL = 40; // ms between trail dots
  const trailDots = [];
  let trailHistory = [];
  let lastTrailTime = 0;

  let mouseX = -200, mouseY = -200;
  let raf;

  // Create trail dot pool
  for (let i = 0; i < TRAIL_LENGTH; i++) {
    const dot = document.createElement('div');
    dot.className = 'trail-dot';
    dot.style.opacity = '0';
    trail.appendChild(dot);
    trailDots.push(dot);
  }

  let dotIndex = 0;

  function spawnTrailDot(x, y) {
    const dot = trailDots[dotIndex % TRAIL_LENGTH];
    dot.style.left = x + 'px';
    dot.style.top  = y + 'px';
    dot.style.opacity = '0.5';
    dot.style.animation = 'none';
    // Trigger reflow to restart animation
    void dot.offsetWidth;
    dot.style.animation = 'trailFade 0.5s ease forwards';
    dotIndex++;
  }

  function onMouseMove(e) {
    mouseX = e.clientX;
    mouseY = e.clientY;

    cursor.style.transform = `translate(${mouseX}px, ${mouseY}px)`;

    // Spawn trail dots at intervals
    const now = performance.now();
    if (now - lastTrailTime > TRAIL_INTERVAL) {
      spawnTrailDot(mouseX, mouseY);
      lastTrailTime = now;
    }
  }

  function onMouseEnter() { document.body.classList.remove('cursor-hidden'); }
  function onMouseLeave() { document.body.classList.add('cursor-hidden'); }

  // Hover detection for interactive elements
  const interactiveSelector = 'a, button, [data-magnetic], [data-card], input, textarea, select, label';

  document.addEventListener('mouseover', (e) => {
    if (e.target.closest(interactiveSelector)) {
      document.body.classList.add('cursor-hover');
    }
  });
  document.addEventListener('mouseout', (e) => {
    if (e.target.closest(interactiveSelector)) {
      document.body.classList.remove('cursor-hover');
    }
  });

  // Section-based color change
  const sectionColors = {
    hero:       '#00e5ff',
    manifesto:  '#7c3aed',
    signal:     '#00e5ff',
    operations: '#ff006e',
    contact:    '#7c3aed',
  };

  const colorObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const id = entry.target.id;
        const color = sectionColors[id];
        if (color && ring) {
          ring.style.borderColor = color;
          // Update trail dot color
          trailDots.forEach(d => { d.style.background = color; });
        }
      }
    });
  }, { threshold: 0.5 });

  Object.keys(sectionColors).forEach(id => {
    const el = document.getElementById(id);
    if (el) colorObserver.observe(el);
  });

  document.addEventListener('mousemove', onMouseMove, { passive: true });
  document.addEventListener('mouseenter', onMouseEnter);
  document.addEventListener('mouseleave', onMouseLeave);
})();
