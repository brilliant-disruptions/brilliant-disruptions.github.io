import { describe, expect, it } from "vitest";
import { Color } from "three";
import { THEMES } from "./themes";

describe("THEMES", () => {
  it("defines exactly five palettes", () => {
    expect(THEMES).toHaveLength(5);
    expect(THEMES.map((t) => t.name)).toEqual([
      "Magma & Cyan",
      "Hot Rod & Gold",
      "Arc Reactor",
      "Falcon",
      "Solar Flare",
    ]);
  });

  it("every palette is complete", () => {
    for (const t of THEMES) {
      expect(t.core).toHaveLength(4);
      for (const c of t.core) expect(c).toBeInstanceOf(Color);
      expect(t.vein.surface).toBeInstanceOf(Color);
      expect(t.vein.coreA).toBeInstanceOf(Color);
      expect(t.vein.coreB).toBeInstanceOf(Color);
      expect(t.dust).toBeInstanceOf(Color);
      expect(t.bg).toBeInstanceOf(Color);
      expect(t.swatch).toContain("linear-gradient");
      expect(t.accent).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});
