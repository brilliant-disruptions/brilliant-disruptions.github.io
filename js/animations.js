/**
 * animations.js — GSAP ScrollTrigger, text effects, card interactions
 */

(function () {
  'use strict';

  // ─── Nav scroll behavior ─────────────────────────────────────────────────
  function initNav() {
    const nav = document.getElementById('nav');
    if (!nav) return;

    let lastY = 0;
    window.addEventListener('scroll', () => {
      const y = window.scrollY;
      if (y > 40) {
        nav.classList.add('scrolled');
      } else {
        nav.classList.remove('scrolled');
      }
      lastY = y;
    }, { passive: true });

    // Mobile hamburger
    const hamburger = document.getElementById('nav-hamburger');
    const mobileMenu = document.getElementById('nav-mobile-menu');
    if (hamburger && mobileMenu) {
      hamburger.addEventListener('click', () => {
        const isOpen = hamburger.classList.toggle('open');
        hamburger.setAttribute('aria-expanded', String(isOpen));
        mobileMenu.classList.toggle('open', isOpen);
      });

      // Close on link click
      mobileMenu.querySelectorAll('.mobile-link').forEach(link => {
        link.addEventListener('click', () => {
          hamburger.classList.remove('open');
          hamburger.setAttribute('aria-expanded', 'false');
          mobileMenu.classList.remove('open');
        });
      });
    }
  }

  // ─── Scramble text effect ─────────────────────────────────────────────────
  const SCRAMBLE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$&*';

  function scrambleText(element, finalText, duration, delay, onDone) {
    const letters = finalText.split('');
    let startTime = null;

    function frame(ts) {
      if (!startTime) startTime = ts;
      const elapsed = ts - startTime;
      const progress = Math.min(elapsed / duration, 1);

      const resolveCount = Math.floor(progress * letters.length);

      let display = '';
      for (let i = 0; i < letters.length; i++) {
        if (letters[i] === ' ') { display += ' '; continue; }
        if (i < resolveCount) {
          display += letters[i];
        } else {
          display += SCRAMBLE_CHARS[Math.floor(Math.random() * SCRAMBLE_CHARS.length)];
        }
      }
      element.textContent = display;

      if (progress < 1) {
        requestAnimationFrame(frame);
      } else {
        element.textContent = finalText;
        if (onDone) onDone();
      }
    }

    setTimeout(() => requestAnimationFrame(frame), delay || 0);
  }

  // ─── Hero reveal (called from main.js after loading) ─────────────────────
  function revealHero() {
    const eyebrow = document.getElementById('hero-eyebrow');
    const h1 = document.getElementById('headline-1');
    const h2 = document.getElementById('headline-2');
    const sub = document.getElementById('hero-sub');
    const ctas = document.getElementById('hero-ctas');

    if (eyebrow) {
      setTimeout(() => eyebrow.classList.add('visible'), 100);
    }

    if (h1 && h2) {
      setTimeout(() => h1.classList.add('visible'), 300);
      setTimeout(() => h2.classList.add('visible'), 500);

      // Scramble the headline text for extra drama
      setTimeout(() => {
        scrambleText(h1, 'BRILLIANT', 1200, 0, null);
      }, 300);
      setTimeout(() => {
        scrambleText(h2, 'DISRUPTIONS', 1600, 0, null);
      }, 500);
    }

    if (sub) setTimeout(() => sub.classList.add('visible'), 900);
    if (ctas) setTimeout(() => ctas.classList.add('visible'), 1100);
  }

  // ─── Manifesto scroll ────────────────────────────────────────────────────
  function initManifesto() {
    if (typeof gsap === 'undefined' || typeof ScrollTrigger === 'undefined') {
      // Fallback: Intersection Observer
      initManifestoFallback();
      return;
    }

    gsap.registerPlugin(ScrollTrigger);

    const section = document.getElementById('manifesto');
    if (!section) return;

    const statements = section.querySelectorAll('.manifesto-statement');
    const progressDots = section.querySelectorAll('.progress-dot');
    const statementsWrap = document.getElementById('manifesto-statements');
    if (!statements.length) return;

    // Make first statement active
    statements[0].classList.add('active');

    let currentIndex = 0;

    function showStatement(idx) {
      if (idx === currentIndex) return;
      const prev = statements[currentIndex];
      const next = statements[idx];

      prev.classList.remove('active');
      prev.classList.add('exit');
      setTimeout(() => prev.classList.remove('exit'), 500);

      next.classList.add('active');
      next.classList.add('enter');
      setTimeout(() => next.classList.remove('enter'), 700);

      progressDots.forEach((d, i) => d.classList.toggle('active', i === idx));
      currentIndex = idx;
    }

    const totalScrollDist = window.innerHeight * (statements.length + 0.5);

    ScrollTrigger.create({
      trigger: section,
      start: 'top top',
      end: '+=' + totalScrollDist,
      pin: true,
      pinSpacing: true,
      scrub: false,
      onUpdate: (self) => {
        const idx = Math.min(
          Math.floor(self.progress * statements.length),
          statements.length - 1
        );
        showStatement(idx);
      }
    });
  }

  function initManifestoFallback() {
    const statements = document.querySelectorAll('.manifesto-statement');
    const progressDots = document.querySelectorAll('.progress-dot');
    if (!statements.length) return;
    statements[0].classList.add('active');
    progressDots[0] && progressDots[0].classList.add('active');

    let currentIndex = 0;
    let cooldown = false;

    window.addEventListener('wheel', (e) => {
      if (cooldown) return;
      const section = document.getElementById('manifesto');
      if (!section) return;
      const rect = section.getBoundingClientRect();
      if (rect.top > 20 || rect.bottom < window.innerHeight * 0.2) return;

      const dir = e.deltaY > 0 ? 1 : -1;
      const nextIdx = currentIndex + dir;
      if (nextIdx < 0 || nextIdx >= statements.length) return;

      e.preventDefault();
      cooldown = true;
      setTimeout(() => { cooldown = false; }, 700);

      statements[currentIndex].classList.remove('active');
      currentIndex = nextIdx;
      statements[currentIndex].classList.add('active');
      progressDots.forEach((d, i) => d.classList.toggle('active', i === currentIndex));
    }, { passive: false });
  }

  // ─── Scroll reveal (generic) ──────────────────────────────────────────────
  function initScrollReveal() {
    const revealEls = document.querySelectorAll('.reveal-up');
    if (!revealEls.length) return;

    if ('IntersectionObserver' in window) {
      const obs = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            const delay = entry.target.dataset.delay;
            if (delay) {
              entry.target.style.transitionDelay = (parseInt(delay) / 1000) + 's';
            }
            entry.target.classList.add('visible');
            obs.unobserve(entry.target);
          }
        });
      }, { threshold: 0.15 });

      revealEls.forEach(el => obs.observe(el));
    } else {
      revealEls.forEach(el => el.classList.add('visible'));
    }
  }

  // ─── Stat counters ────────────────────────────────────────────────────────
  function initCounters() {
    const counters = document.querySelectorAll('.counter');
    if (!counters.length) return;

    const obs = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        const el = entry.target;
        const target = parseInt(el.dataset.target);
        const suffix = el.dataset.suffix || '';
        const duration = 2000;
        const start = performance.now();

        function frame(ts) {
          const elapsed = ts - start;
          const progress = Math.min(elapsed / duration, 1);
          const eased = 1 - Math.pow(1 - progress, 3); // ease out cubic
          const val = Math.floor(eased * target);
          el.textContent = val.toLocaleString() + suffix;

          if (progress < 1) {
            requestAnimationFrame(frame);
          } else {
            el.textContent = target.toLocaleString() + suffix;
            el.closest('.signal-card-value').style.animation = 'counterPop 0.3s ease';
          }
        }
        requestAnimationFrame(frame);

        // Animate bar fills
        const card = el.closest('.signal-card');
        if (card) {
          card.classList.add('animated');
        }

        obs.unobserve(el);
      });
    }, { threshold: 0.5 });

    counters.forEach(el => obs.observe(el));
  }

  // ─── Holographic card + 3D tilt ──────────────────────────────────────────
  function initCards() {
    const cards = document.querySelectorAll('[data-card]');
    cards.forEach(card => {
      const holoOverlay = card.querySelector('.card-holo-overlay');

      card.addEventListener('mousemove', (e) => {
        const rect = card.getBoundingClientRect();
        const cx = (e.clientX - rect.left) / rect.width - 0.5;   // -0.5 to 0.5
        const cy = (e.clientY - rect.top)  / rect.height - 0.5;  // -0.5 to 0.5

        const rotX = cy * -18;
        const rotY = cx * 18;

        card.style.transform =
          `perspective(1000px) rotateX(${rotX}deg) rotateY(${rotY}deg) scale(1.02)`;
        card.style.transition = 'transform 0.1s ease';

        // Holographic angle from mouse position
        const angle = (Math.atan2(cy, cx) * 180 / Math.PI) + 180;
        if (holoOverlay) {
          holoOverlay.style.setProperty('--holo-angle', `${angle}deg`);
          // Also shift the background-position for shimmer
          holoOverlay.style.backgroundImage = `conic-gradient(
            from ${angle}deg at ${(cx + 0.5) * 100}% ${(cy + 0.5) * 100}%,
            rgba(255, 0, 110, 0.12),
            rgba(124, 58, 237, 0.2),
            rgba(0, 229, 255, 0.2),
            rgba(0, 229, 255, 0.12),
            rgba(124, 58, 237, 0.2),
            rgba(255, 0, 110, 0.12)
          )`;
        }
      });

      card.addEventListener('mouseleave', () => {
        card.style.transform = 'perspective(1000px) rotateX(0deg) rotateY(0deg) scale(1)';
        card.style.transition = 'transform 0.6s cubic-bezier(0.16, 1, 0.3, 1)';
      });
    });
  }

  // ─── Magnetic buttons ─────────────────────────────────────────────────────
  function initMagneticButtons() {
    const buttons = document.querySelectorAll('[data-magnetic]');
    buttons.forEach(btn => {
      btn.addEventListener('mousemove', (e) => {
        const rect = btn.getBoundingClientRect();
        const x = (e.clientX - rect.left - rect.width / 2) * 0.25;
        const y = (e.clientY - rect.top - rect.height / 2) * 0.25;
        btn.style.transform = `translate(${x}px, ${y}px)`;
        btn.style.transition = 'transform 0.2s ease';
      });

      btn.addEventListener('mouseleave', () => {
        btn.style.transform = 'translate(0, 0)';
        btn.style.transition = 'transform 0.6s cubic-bezier(0.16, 1, 0.3, 1)';
      });
    });
  }

  // ─── Animate stat bar fills ───────────────────────────────────────────────
  function initSignalBars() {
    const bars = document.querySelectorAll('.signal-bar-fill');
    const obs = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.style.width = entry.target.parentElement.parentElement
            .querySelector('.signal-bar-fill').style.getPropertyValue('--fill') || '0%';
          obs.unobserve(entry.target);
        }
      });
    }, { threshold: 0.5 });
    bars.forEach(b => obs.observe(b));
  }

  // ─── Parallax on floating orbs ────────────────────────────────────────────
  function initParallax() {
    const orbs = document.querySelectorAll('.orb--hero-1, .orb--hero-2, .orb--hero-3');
    if (!orbs.length) return;

    window.addEventListener('mousemove', (e) => {
      const cx = (e.clientX / window.innerWidth - 0.5) * 2;
      const cy = (e.clientY / window.innerHeight - 0.5) * 2;
      orbs.forEach((orb, i) => {
        const factor = (i + 1) * 8;
        orb.style.transform = `translate(${cx * factor}px, ${cy * factor}px)`;
      });
    }, { passive: true });
  }

  // ─── Public API ───────────────────────────────────────────────────────────
  window.AnimationsAPI = {
    revealHero,
    initAll: function () {
      initNav();
      initManifesto();
      initScrollReveal();
      initCounters();
      initCards();
      initMagneticButtons();
      initParallax();
    }
  };
})();
