import { describe, expect, it } from "vitest";
import { FALLBACK, INTENTS, matchIntent } from "./intents";

const responsesOf = (id: string): string[] => {
  const intent = INTENTS.find((i) => i.id === id);
  if (!intent) throw new Error(`no intent ${id}`);
  return Array.isArray(intent.response) ? intent.response : [intent.response];
};

describe("matchIntent", () => {
  it("matches a greeting", () => {
    expect(responsesOf("greeting")).toContain(matchIntent("hey there"));
  });

  it("is case-insensitive", () => {
    expect(matchIntent("WHO ARE YOU?")).toContain("JARVIS");
  });

  it("returns one of the listed responses for multi-response intents", () => {
    expect(responsesOf("joke")).toContain(matchIntent("tell me a joke"));
  });

  it("matches company questions", () => {
    expect(matchIntent("tell me about brilliant disruptions")).toContain("Brilliant Disruptions");
  });

  it("falls back on unrecognized input", () => {
    expect(matchIntent("florble grombit xyzzy")).toBe(FALLBACK);
  });

  it("falls back on empty input", () => {
    expect(matchIntent("")).toBe(FALLBACK);
  });
});
