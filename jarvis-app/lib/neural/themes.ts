/**
 * Theme palettes for the JARVIS magma-core scene.
 *
 * Each palette drives every color channel in the scene (core gradient, vein
 * pulses, globe outline, volcano points, dust, fog/background) plus the CSS
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
  /** Globe continent-outline color (HDR — values >1 feed bloom). */
  boundary: Color;
  volcano: Color;
  dust: Color;
  bg: Color;
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
    boundary: new Color(0.0, 1.5, 3.0),
    volcano: new Color(0xff5500),
    dust: new Color(0x223355),
    bg: new Color(0x010102),
  },
  {
    name: "Neon Void",
    swatch: "linear-gradient(135deg, #ff00ff, #00ff00)",
    accent: "#ff00ff",
    core: [
      new Color(0.05, 0.0, 0.1),
      new Color(0.5, 0.0, 0.5),
      new Color(1.0, 0.0, 0.8),
      new Color(1.0, 0.5, 1.0),
    ],
    vein: {
      surface: new Color(0.2, 1.0, 0.2),
      coreA: new Color(0.8, 0.0, 0.8),
      coreB: new Color(0.0, 0.8, 1.0),
    },
    boundary: new Color(2.0, 0.0, 1.5),
    volcano: new Color(0x00ff00),
    dust: new Color(0x2a0044),
    bg: new Color(0x020005),
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
    boundary: new Color(1.5, 1.5, 2.5),
    volcano: new Color(0xffffff),
    dust: new Color(0x443311),
    bg: new Color(0x000103),
  },
];
