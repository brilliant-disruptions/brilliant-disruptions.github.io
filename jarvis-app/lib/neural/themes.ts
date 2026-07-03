/**
 * Theme palettes for the JARVIS magma-core scene.
 *
 * Each palette drives every color channel in the scene (core gradient, vein
 * pulses, dust) plus the CSS
 * bits the ThemeSwitcher needs (thumb gradient + glow accent). The scene lerps
 * all channels toward the active palette each frame, so switching cross-fades.
 */

import { Color } from "three";

export type NeuralTheme = {
  name: string;
  /** CSS background for the switcher thumb. */
  swatch: string;
  /** CSS hex color for the switcher's rotating border + active glow. */
  accent: string;
  /** Core sphere gradient stops: dark → hot mid → bright → peak. */
  core: [Color, Color, Color, Color];
  vein: { surface: Color; coreA: Color; coreB: Color };
  dust: Color;
};

export const THEMES: NeuralTheme[] = [
  {
    name: "Magma & Cyan",
    swatch: "linear-gradient(135deg, #00d2ff, #ff5500)",
    accent: "#00d2ff",
    core: [
      new Color(0.1, 0.0, 0.0),
      new Color(0.9, 0.05, 0.0),
      new Color(1.0, 0.4, 0.0),
      new Color(1.0, 0.9, 0.2),
    ],
    vein: {
      surface: new Color(0.0, 0.8, 1.0),
      coreA: new Color(0.8, 0.1, 0.0),
      coreB: new Color(1.0, 0.6, 0.0),
    },
    dust: new Color(0x223355),
  },
  {
    name: "Hot Rod & Gold",
    swatch: "linear-gradient(135deg, #b3001b, #ffcf40)",
    accent: "#ffcf40",
    core: [
      new Color(0.08, 0.0, 0.01),
      new Color(0.75, 0.02, 0.05),
      new Color(1.0, 0.25, 0.05),
      new Color(1.0, 0.8, 0.25),
    ],
    vein: {
      surface: new Color(0.55, 0.85, 1.0),
      coreA: new Color(0.9, 0.1, 0.05),
      coreB: new Color(1.0, 0.75, 0.2),
    },
    dust: new Color(0x332211),
  },
  {
    name: "Arc Reactor",
    swatch: "linear-gradient(135deg, #0a2f66, #cfeaff)",
    accent: "#7fd4ff",
    core: [
      new Color(0.0, 0.02, 0.08),
      new Color(0.05, 0.25, 0.8),
      new Color(0.3, 0.7, 1.0),
      new Color(1.3, 1.4, 1.5),
    ],
    vein: {
      surface: new Color(1.0, 0.85, 0.45),
      coreA: new Color(0.1, 0.5, 1.0),
      coreB: new Color(0.6, 0.9, 1.0),
    },
    dust: new Color(0x112a44),
  },
  {
    name: "Falcon",
    swatch: "linear-gradient(135deg, #1b2735, #e8eef5)",
    accent: "#c9d4e0",
    core: [
      new Color(0.02, 0.03, 0.05),
      new Color(0.35, 0.4, 0.5),
      new Color(0.8, 0.85, 0.95),
      new Color(1.4, 1.4, 1.5),
    ],
    vein: {
      surface: new Color(0.85, 0.92, 1.0),
      coreA: new Color(0.5, 0.6, 0.75),
      coreB: new Color(1.0, 1.0, 1.0),
    },
    dust: new Color(0x2a3340),
  },
  {
    name: "Solar Flare",
    swatch: "linear-gradient(135deg, #0055ff, #ffdd00)",
    accent: "#ffdd00",
    core: [
      new Color(0.05, 0.02, 0.0),
      new Color(0.8, 0.4, 0.0),
      new Color(1.0, 0.8, 0.2),
      new Color(1.5, 1.5, 1.5),
    ],
    vein: {
      surface: new Color(0.0, 0.3, 2.0),
      coreA: new Color(1.0, 0.8, 0.0),
      coreB: new Color(1.0, 0.3, 0.0),
    },
    dust: new Color(0x443311),
  },
];
