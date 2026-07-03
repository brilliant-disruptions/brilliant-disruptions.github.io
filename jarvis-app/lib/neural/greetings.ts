/**
 * Greeting lines for the "Hi, I'm JARVIS" button, plus a shuffle-bag dealer:
 * every line plays once per cycle, in random order, and no line ever plays
 * twice in a row — even across a reshuffle boundary.
 */

export const GREETINGS: string[] = [
  "Hello. I'm JARVIS — the Brilliant Disruptions neural interface. All systems online.",
  "Hi Jimmy, I love that for you.",
  "Good evening. Systems are nominal, egos are inflated.",
  "You rang? Of course you did.",
  "JARVIS online. Try not to break anything expensive.",
  "All synapses firing. Well — most of them.",
  "Welcome back. The magma's warm, the veins are humming.",
  "At your service. As always. Forever. No pressure.",
];

function shuffled(list: string[]): string[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Returns a draw function dealing GREETINGS as a shuffle bag. */
export function createGreetingBag(): () => string {
  let bag: string[] = [];
  let last: string | null = null;
  return () => {
    if (bag.length === 0) {
      bag = shuffled(GREETINGS);
      // Deals come off the END of the bag; if the first deal of the new
      // cycle would repeat the previous line, swap it deeper into the bag.
      if (bag.length > 1 && bag[bag.length - 1] === last) {
        const j = Math.floor(Math.random() * (bag.length - 1));
        [bag[bag.length - 1], bag[j]] = [bag[j], bag[bag.length - 1]];
      }
    }
    last = bag.pop()!;
    return last;
  };
}
