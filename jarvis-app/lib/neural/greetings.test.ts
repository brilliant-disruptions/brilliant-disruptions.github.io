import { describe, expect, it } from "vitest";
import { GREETINGS, createGreetingBag } from "./greetings";

describe("GREETINGS", () => {
  it("has 8 lines including the Jimmy greeting verbatim", () => {
    expect(GREETINGS).toHaveLength(8);
    expect(GREETINGS).toContain("Hi Jimmy, I love that for you.");
  });
});

describe("createGreetingBag", () => {
  it("deals every greeting exactly once per cycle", () => {
    const draw = createGreetingBag();
    const cycle = Array.from({ length: GREETINGS.length }, () => draw());
    expect([...cycle].sort()).toEqual([...GREETINGS].sort());
  });

  it("never deals the same greeting twice in a row across 200 draws", () => {
    const draw = createGreetingBag();
    let prev = draw();
    for (let i = 0; i < 200; i++) {
      const next = draw();
      expect(next).not.toBe(prev);
      expect(GREETINGS).toContain(next);
      prev = next;
    }
  });
});
