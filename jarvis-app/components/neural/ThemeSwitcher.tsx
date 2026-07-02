"use client";

/**
 * ThemeSwitcher — the magma-core palette picker: a glass pill with a rotating
 * conic-gradient border and one gradient swatch per theme. Renders inside the
 * Neural page's pointer-events-none overlay, so it re-enables pointer events
 * on its root.
 */

import type { CSSProperties } from "react";
import { THEMES } from "@/lib/neural/themes";

export function ThemeSwitcher({
  active,
  onChange,
}: {
  active: number;
  onChange: (index: number) => void;
}) {
  return (
    <div
      className="theme-switcher pointer-events-auto"
      style={{ "--theme-color": THEMES[active].accent } as CSSProperties}
    >
      <div aria-hidden className="theme-switcher-border" />
      <div className="theme-switcher-content">
        {THEMES.map((t, i) => (
          <button
            key={t.name}
            type="button"
            title={t.name}
            aria-label={`${t.name} theme`}
            aria-pressed={i === active}
            onClick={() => onChange(i)}
            className={`theme-thumb ${i === active ? "active" : ""}`}
            style={{ background: t.swatch }}
          />
        ))}
      </div>
    </div>
  );
}
