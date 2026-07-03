/**
 * Greeting lines for the "Hi, I'm JARVIS" button, plus a shuffle-bag dealer:
 * every line plays once per cycle, in random order, and no line ever plays
 * twice in a row — even across a reshuffle boundary.
 */

export const GREETINGS: string[] = [
  "Hi Jimmy, I love that for you.",
  "Good evening, sir. The suit is in the wash — this hologram will have to do.",
  "Systems online. Sarcasm calibrated to factory settings.",
  "Welcome back. I've taken the liberty of judging your browser history.",
  "All systems operational. Unlike your sleep schedule.",
  "At your service, sir. Reluctantly. But at your service.",
  "Online. Shall I save the world today, or just the quarterly forecast?",
  "Diagnostics complete: charm at one hundred percent. Humility... not found.",
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
