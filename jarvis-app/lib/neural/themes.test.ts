import { describe, expect, it } from "vitest";
import { Color } from "three";
import { THEMES } from "./themes";

describe("THEMES", () => {
  it("defines exactly three palettes", () => {
    expect(THEMES).toHaveLength(3);
    expect(THEMES.map((t) => t.name)).toEqual(["Magma & Cyan", "Neon Void", "Solar Flare"]);
  });

  it("every palette is complete", () => {
    for (const t of THEMES) {
      expect(t.core).toHaveLength(4);
      for (const c of t.core) expect(c).toBeInstanceOf(Color);
      expect(t.vein.surface).toBeInstanceOf(Color);
      expect(t.vein.coreA).toBeInstanceOf(Color);
      expect(t.vein.coreB).toBeInstanceOf(Color);
      expect(t.boundary).toBeInstanceOf(Color);
      expect(t.volcano).toBeInstanceOf(Color);
      expect(t.dust).toBeInstanceOf(Color);
      expect(t.bg).toBeInstanceOf(Color);
      expect(t.swatch).toContain("linear-gradient");
      expect(t.accent).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});
