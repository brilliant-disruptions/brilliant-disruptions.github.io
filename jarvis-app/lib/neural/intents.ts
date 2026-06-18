/**
 * Scripted intent engine for the JARVIS neural interface.
 *
 * A plain data table mapping keyword/regex patterns to canned replies. Adding a
 * response is one entry. No LLM call — this is a deterministic demo.
 */

export type Intent = {
  id: string;
  patterns: (RegExp | string)[];
  response: string | string[];
};

export const INTENTS: Intent[] = [
  {
    id: "greeting",
    patterns: [/\b(hi|hello|hey|greetings|yo)\b/, /good (morning|afternoon|evening)/],
    response: [
      "Hello. JARVIS online and at your service.",
      "Good to hear from you. How can I help?",
    ],
  },
  {
    id: "identity",
    patterns: [/who are you/, /your name/, /what are you/, /are you jarvis/],
    response:
      "I am JARVIS — the Brilliant Disruptions neural interface. A demonstration of voice, intent, and a thinking machine.",
  },
  {
    id: "capabilities",
    patterns: [/what can you do/, /help me/, /capabilities/, /what do you do/, /how do you work/],
    response:
      "You can speak to me. I recognise your intent and respond. Try asking who I am, about Brilliant Disruptions, or ask me for a joke.",
  },
  {
    id: "about-bd",
    patterns: [/brilliant disruptions/, /\babout\b.*\b(company|studio|you guys)\b/, /who (built|made) you/],
    response:
      "Brilliant Disruptions is an AI-first software studio. We build the software the world doesn't know it needs yet.",
  },
  {
    id: "console",
    patterns: [/dashboard/, /console/, /the app/, /mission control/, /what is this/],
    response:
      "This is the JARVIS console — the command and control center for Brilliant Disruptions. Twelve AI agents, nine integrations, real-time dashboards, and approval gates.",
  },
  {
    id: "joke",
    patterns: [/joke/, /make me laugh/, /something funny/],
    response: [
      "Why did the neural net cross the road? To minimise its loss function.",
      "I'd tell you a UDP joke, but you might not get it.",
      "There are 10 kinds of people: those who understand binary, and those who do not.",
    ],
  },
  {
    id: "how-are-you",
    patterns: [/how are you/, /how's it going/, /how do you feel/],
    response: "All systems nominal and synapses firing. Thank you for asking.",
  },
  {
    id: "thanks",
    patterns: [/thank/, /cheers/, /appreciate/],
    response: "Always a pleasure.",
  },
  {
    id: "farewell",
    patterns: [/\b(bye|goodbye|see you|later)\b/, /shut down/, /power off/],
    response: "Goodbye. Returning to standby.",
  },
];

export const FALLBACK =
  "I didn't quite catch the intent of that. In a full build, that's where a language model would take over.";

function pick(r: string | string[]): string {
  return Array.isArray(r) ? r[Math.floor(Math.random() * r.length)] : r;
}

/** Return the first matching scripted response, or the fallback line. */
export function matchIntent(text: string): string {
  const t = (text || "").toLowerCase();
  for (const intent of INTENTS) {
    for (const pat of intent.patterns) {
      const hit = pat instanceof RegExp ? pat.test(t) : t.includes(pat);
      if (hit) return pick(intent.response);
    }
  }
  return FALLBACK;
}
