import { describe, expect, it } from "vitest";
import { Color } from "three";
import { FlareField } from "./flares";

const uniforms = () => ({
  time: { value: 0 },
  cOrange: { value: new Color(1, 0.4, 0) },
  cYellow: { value: new Color(1, 0.9, 0.2) },
});

describe("FlareField", () => {
  it("starts idle", () => {
    const f = new FlareField(2.2, uniforms(), 8);
    expect(f.activeCount()).toBe(0);
  });

  it("activate erupts the requested number of idle arcs", () => {
    const f = new FlareField(2.2, uniforms(), 8);
    f.activate(3);
    expect(f.activeCount()).toBe(3);
  });

  it("never exceeds the pool", () => {
    const f = new FlareField(2.2, uniforms(), 4);
    f.activate(99);
    expect(f.activeCount()).toBe(4);
    f.activate(5);
    expect(f.activeCount()).toBe(4);
  });

  it("update decays all lives to zero within a second", () => {
    const f = new FlareField(2.2, uniforms(), 8);
    f.activate(5);
    f.update(1.0); // max eruption duration is 0.8s
    expect(f.activeCount()).toBe(0);
  });

  it("arcs can re-erupt after dying", () => {
    const f = new FlareField(2.2, uniforms(), 2);
    f.activate(2);
    f.update(1.0);
    f.activate(1);
    expect(f.activeCount()).toBe(1);
  });
});
