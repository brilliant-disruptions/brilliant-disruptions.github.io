/**
 * JarvisListener — one tap, at most one transcript.
 *
 * Wraps the browser's SpeechRecognition (including Chrome's webkit-prefixed
 * constructor) in single-utterance mode and de-duplicates its event soup:
 * onResult fires at most once with the top transcript, onEnd fires exactly
 * once when recognition finishes for any reason (result, silence, error,
 * abort). No scene, sound, or intent knowledge — the page composes those.
 * Ambient types live in speech.d.ts.
 */

export type ListenHandlers = {
  onResult: (transcript: string) => void;
  onEnd: () => void;
  onError: (code: string) => void;
};

export class JarvisListener {
  private recognition: SpeechRecognition | null = null;
  private endedNotified = false;

  static isSupported(): boolean {
    return (
      typeof window !== "undefined" &&
      !!(window.SpeechRecognition ?? window.webkitSpeechRecognition)
    );
  }

  /** Start a single-utterance listen. No-op if one is already running. */
  start(handlers: ListenHandlers): void {
    if (this.recognition) return;
    const Ctor =
      typeof window !== "undefined"
        ? (window.SpeechRecognition ?? window.webkitSpeechRecognition)
        : undefined;
    if (!Ctor) {
      handlers.onError("unsupported");
      handlers.onEnd();
      return;
    }

    this.endedNotified = false;
    const rec = new Ctor();
    rec.lang = "en-US";
    rec.continuous = false;
    rec.interimResults = false;
    rec.maxAlternatives = 1;

    const finish = () => {
      if (this.endedNotified) return;
      this.endedNotified = true;
      this.recognition = null;
      handlers.onEnd();
    };

    rec.onresult = (ev) => {
      const last = ev.results[ev.results.length - 1];
      const transcript = last?.[0]?.transcript?.trim();
      if (transcript) handlers.onResult(transcript);
    };
    rec.onerror = (ev) => {
      handlers.onError(ev.error || "unknown");
      finish();
    };
    rec.onend = finish;

    this.recognition = rec;
    try {
      rec.start();
    } catch {
      // start() throws if the engine already has an active session.
      handlers.onError("start-failed");
      finish();
    }
  }

  /** Abort any in-flight recognition; safe to call when idle. */
  stop(): void {
    const rec = this.recognition;
    if (!rec) return;
    try {
      rec.abort(); // fires onend → finish() clears state and notifies
    } catch {
      this.recognition = null;
    }
  }
}
