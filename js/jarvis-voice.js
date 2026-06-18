/**
 * jarvis-voice.js — Web Speech (recognition + synthesis) + scripted intent
 * engine, wired to the NeuralScene state machine.
 *
 * Flow: mic press → SpeechRecognition listens (live transcript) → on a final
 * result the intent engine matches a canned reply → the brain "thinks" → JARVIS
 * speaks the reply (SpeechSynthesis) while the brain pulses → returns to idle.
 *
 * Graceful degradation:
 *   - No SpeechRecognition (e.g. Firefox) or mic denied → text input fallback.
 *   - No SpeechSynthesis → reply is shown on screen with a timed brain pulse.
 */

(function () {
  'use strict';

  // ─── Scripted intent engine (append an object to add a response) ───────────
  const INTENTS = [
    {
      id: 'greeting',
      patterns: [/\b(hi|hello|hey|greetings|yo)\b/, /good (morning|afternoon|evening)/],
      response: [
        'Hello. JARVIS online and at your service.',
        'Good to hear from you. How can I help?'
      ]
    },
    {
      id: 'identity',
      patterns: [/who are you/, /your name/, /what are you/, /are you jarvis/],
      response: 'I am JARVIS — the Brilliant Disruptions neural interface. A demonstration of voice, intent, and a thinking machine.'
    },
    {
      id: 'capabilities',
      patterns: [/what can you do/, /help me/, /capabilities/, /what do you do/, /how do you work/],
      response: 'You can speak to me. I recognise your intent and respond. Try asking who I am, about Brilliant Disruptions, or ask me for a joke.'
    },
    {
      id: 'about-bd',
      patterns: [/brilliant disruptions/, /\babout\b.*\b(company|studio|you guys)\b/, /who (built|made) you/],
      response: "Brilliant Disruptions is an AI-first software studio. We build the software the world doesn't know it needs yet."
    },
    {
      id: 'joke',
      patterns: [/joke/, /make me laugh/, /something funny/],
      response: [
        'Why did the neural net cross the road? To minimise its loss function.',
        "I'd tell you a UDP joke, but you might not get it.",
        'There are 10 kinds of people: those who understand binary, and those who do not.'
      ]
    },
    {
      id: 'how-are-you',
      patterns: [/how are you/, /how's it going/, /how do you feel/],
      response: 'All systems nominal and synapses firing. Thank you for asking.'
    },
    {
      id: 'thanks',
      patterns: [/thank/, /cheers/, /appreciate/],
      response: 'Always a pleasure.'
    },
    {
      id: 'farewell',
      patterns: [/\b(bye|goodbye|see you|later)\b/, /shut down/, /power off/],
      response: 'Goodbye. Returning to standby.'
    }
  ];

  const FALLBACK = "I didn't quite catch the intent of that. In a full build, that's where a language model would take over.";

  function pick(r) { return Array.isArray(r) ? r[(Math.random() * r.length) | 0] : r; }

  const Intents = {
    match: function (text) {
      const t = (text || '').toLowerCase();
      for (let i = 0; i < INTENTS.length; i++) {
        const patterns = INTENTS[i].patterns;
        for (let p = 0; p < patterns.length; p++) {
          const pat = patterns[p];
          const hit = pat instanceof RegExp ? pat.test(t) : t.indexOf(pat) !== -1;
          if (hit) return pick(INTENTS[i].response);
        }
      }
      return FALLBACK;
    }
  };

  // ─── DOM + state ────────────────────────────────────────────────────────────
  let micBtn, transcriptEl, responseEl, stateEl, hintEl, textForm, textInput;
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const synth = window.speechSynthesis;
  let recognition = null;
  let listening = false;
  let speaking = false;
  let preferredVoice = null;
  let boundaryTimer = null;

  function setStateIndicator(name) {
    if (stateEl) {
      stateEl.dataset.state = name;
      stateEl.textContent = '● ' + name.toUpperCase();
    }
  }

  function neural(method, arg) {
    if (window.NeuralScene && window.NeuralScene[method]) {
      window.NeuralScene[method](arg);
    }
  }

  function setMicUI(active) {
    if (!micBtn) return;
    micBtn.setAttribute('aria-pressed', active ? 'true' : 'false');
    micBtn.classList.toggle('listening', active);
  }

  // ─── Recognition ────────────────────────────────────────────────────────────
  function initRecognition() {
    if (!SR) {
      enableTextFallback('Voice input is not supported in this browser — type to JARVIS instead.');
      return;
    }
    recognition = new SR();
    recognition.lang = 'en-US';
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onstart = function () {
      listening = true;
      setMicUI(true);
      neural('setState', 'listening');
      setStateIndicator('listening');
    };
    recognition.onresult = onResult;
    recognition.onerror = onRecError;
    recognition.onend = function () {
      listening = false;
      setMicUI(false);
      if (!speaking) {
        neural('setState', 'idle');
        setStateIndicator('idle');
      }
    };
  }

  function onResult(e) {
    let interim = '', final = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const txt = e.results[i][0].transcript;
      if (e.results[i].isFinal) final += txt; else interim += txt;
    }
    if (transcriptEl) transcriptEl.textContent = final || interim;
    if (final) handleUtterance(final.trim());
  }

  function onRecError(e) {
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
      enableTextFallback('Microphone access was blocked. You can type to JARVIS instead.');
    } else if (e.error === 'no-speech') {
      if (hintEl) hintEl.textContent = "I didn't hear anything — tap the mic and try again.";
    }
  }

  // ─── Text fallback ──────────────────────────────────────────────────────────
  function enableTextFallback(message) {
    if (textForm) textForm.hidden = false;
    if (textInput) textInput.focus();
    if (hintEl && message) hintEl.textContent = message;
    if (micBtn && !SR) micBtn.classList.add('disabled');
  }

  // ─── Think → speak handoff ───────────────────────────────────────────────────
  function handleUtterance(text) {
    if (!text) return;
    neural('setState', 'thinking');
    setStateIndicator('thinking');
    const reply = Intents.match(text);
    // Brief deliberate delay so the "thinking" burst is visible.
    setTimeout(function () { speak(reply); }, 650);
  }

  // ─── Synthesis ──────────────────────────────────────────────────────────────
  function pickVoice() {
    if (!synth) return null;
    const voices = synth.getVoices();
    if (!voices.length) return null;
    // Prefer a British English voice for the JARVIS feel, else any en voice.
    return voices.find(function (v) { return /en-GB/i.test(v.lang); }) ||
           voices.find(function (v) { return /^en/i.test(v.lang); }) ||
           voices[0];
  }

  function startBoundaryFallback(text) {
    // Some browsers never fire onboundary; pulse on a timer for the estimated
    // speaking duration so the brain always animates while speaking.
    const perPulse = 180;
    const est = Math.max(1200, (text.length / 12) * 1000);
    let elapsed = 0;
    boundaryTimer = setInterval(function () {
      elapsed += perPulse;
      neural('pulse', { count: 2 });
      neural('setAmplitude', 0.5 + Math.random() * 0.4);
      if (elapsed >= est) stopBoundaryFallback();
    }, perPulse);
  }

  function stopBoundaryFallback() {
    if (boundaryTimer) { clearInterval(boundaryTimer); boundaryTimer = null; }
  }

  function finishSpeaking() {
    speaking = false;
    stopBoundaryFallback();
    neural('setState', 'idle');
    setStateIndicator('idle');
  }

  function speak(text) {
    if (responseEl) responseEl.textContent = text;
    speaking = true;
    neural('setState', 'speaking');
    setStateIndicator('speaking');

    if (!synth || typeof SpeechSynthesisUtterance === 'undefined') {
      // No synthesis: drive visuals on a timer, then settle.
      startBoundaryFallback(text);
      setTimeout(finishSpeaking, Math.max(1500, (text.length / 12) * 1000));
      return;
    }

    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.0;
    u.pitch = 0.9;
    if (!preferredVoice) preferredVoice = pickVoice();
    if (preferredVoice) u.voice = preferredVoice;

    let gotBoundary = false;
    u.onstart = function () {
      // If no boundary event arrives shortly, fall back to a timed pulse.
      setTimeout(function () { if (!gotBoundary && speaking) startBoundaryFallback(text); }, 280);
    };
    u.onboundary = function () {
      gotBoundary = true;
      neural('pulse', { count: 2 });
      neural('setAmplitude', 0.6 + Math.random() * 0.4);
    };
    u.onend = finishSpeaking;
    u.onerror = finishSpeaking;
    synth.speak(u);
  }

  // ─── Mic controls ───────────────────────────────────────────────────────────
  function toggleListening() {
    if (!recognition) return;
    if (listening) {
      recognition.stop();
    } else {
      if (transcriptEl) transcriptEl.textContent = '';
      try { recognition.start(); } catch (err) { /* already started */ }
    }
  }

  // ─── Bootstrap ──────────────────────────────────────────────────────────────
  function init() {
    micBtn = document.getElementById('mic-btn');
    transcriptEl = document.getElementById('transcript');
    responseEl = document.getElementById('response-text');
    stateEl = document.getElementById('state-indicator');
    hintEl = document.getElementById('hint');
    textForm = document.getElementById('text-fallback');
    textInput = document.getElementById('text-input');

    if (window.NeuralScene) {
      window.NeuralScene.init('neural-canvas');
      if (!window.NeuralScene.isSupported()) document.body.classList.add('no-webgl');
    }

    initRecognition();

    if (micBtn) {
      micBtn.addEventListener('click', toggleListening);
    }
    if (textForm) {
      textForm.addEventListener('submit', function (e) {
        e.preventDefault();
        const value = textInput.value.trim();
        if (!value) return;
        if (transcriptEl) transcriptEl.textContent = value;
        textInput.value = '';
        handleUtterance(value);
      });
    }

    // Chrome loads voices asynchronously.
    if (synth) {
      preferredVoice = pickVoice();
      synth.addEventListener('voiceschanged', function () { preferredVoice = pickVoice(); });
    }

    // Stop talking if the tab is hidden.
    document.addEventListener('visibilitychange', function () {
      if (document.hidden && synth) synth.cancel();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
