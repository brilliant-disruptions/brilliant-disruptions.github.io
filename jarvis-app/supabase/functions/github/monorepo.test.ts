import { describe, expect, it } from "vitest";
import {
  detectFolderRenames,
  planReconcile,
  topFolder,
  type ExistingBuild,
  type GhFile,
} from "./monorepo";

describe("topFolder", () => {
  it("returns the first path segment, null for root files", () => {
    expect(topFolder("checkout/src/index.ts")).toBe("checkout");
    expect(topFolder("README.md")).toBeNull();
  });
});

describe("detectFolderRenames", () => {
  it("collapses a folder's many file renames into one oldTop → newTop entry", () => {
    // `git mv checkout pay` moves every file under checkout/ — all share a prefix.
    const files: GhFile[] = [
      { status: "renamed", previous_filename: "checkout/index.ts", filename: "pay/index.ts" },
      { status: "renamed", previous_filename: "checkout/db.ts", filename: "pay/db.ts" },
    ];
    const renames = detectFolderRenames(files);
    expect(renames.get("checkout")).toBe("pay");
    expect(renames.size).toBe(1);
  });

  it("ignores in-folder file renames (top unchanged) and non-renames", () => {
    const files: GhFile[] = [
      { status: "renamed", previous_filename: "checkout/old.ts", filename: "checkout/new.ts" },
      { status: "modified", filename: "checkout/index.ts" },
      { status: "added", filename: "billing/index.ts" },
    ];
    expect(detectFolderRenames(files).size).toBe(0);
  });
});

const build = (over: Partial<ExistingBuild> & { github_path: string }): ExistingBuild => ({
  id: `id-${over.github_path}`,
  name: over.github_path,
  is_active: true,
  ...over,
});

describe("planReconcile", () => {
  it("creates a build for a brand-new folder", () => {
    const plan = planReconcile(["billing"], [], new Map());
    expect(plan.creates).toEqual(["billing"]);
    expect(plan.renames).toEqual([]);
    expect(plan.archives).toEqual([]);
  });

  it("renames in place — same build id survives (tickets intact), no create/archive", () => {
    const builds = [build({ github_path: "checkout", id: "b1", name: "checkout" })];
    const plan = planReconcile(["pay"], builds, new Map([["checkout", "pay"]]));
    expect(plan.renames).toEqual([{ id: "b1", from: "checkout", to: "pay", renameName: true }]);
    expect(plan.creates).toEqual([]); // "pay" is the renamed build, not a new folder
    expect(plan.archives).toEqual([]); // "checkout" vanished but was renamed, not deleted
  });

  it("does NOT overwrite a name the user customized in Jarvis", () => {
    const builds = [build({ github_path: "checkout", id: "b1", name: "Checkout Service" })];
    const plan = planReconcile(["pay"], builds, new Map([["checkout", "pay"]]));
    expect(plan.renames[0].renameName).toBe(false);
  });

  it("soft-deletes (archives) a build whose folder disappeared without a rename", () => {
    const builds = [build({ github_path: "legacy", id: "b1" })];
    const plan = planReconcile([], builds, new Map());
    expect(plan.archives).toEqual([{ id: "b1", path: "legacy" }]);
    expect(plan.creates).toEqual([]);
  });

  it("resurrects a soft-deleted build when its folder reappears, instead of duplicating", () => {
    const builds = [build({ github_path: "billing", id: "b1", is_active: false })];
    const plan = planReconcile(["billing"], builds, new Map());
    expect(plan.resurrects).toEqual([{ id: "b1", path: "billing", renameName: true }]);
    expect(plan.creates).toEqual([]);
  });

  it("treats a rename whose source build is missing as a plain create", () => {
    // Folder created + renamed between two syncs: no build at the source yet.
    const plan = planReconcile(["pay"], [], new Map([["checkout", "pay"]]));
    expect(plan.renames).toEqual([]);
    expect(plan.creates).toEqual(["pay"]);
  });

  it("handles a mixed sync: one rename, one new, one removed", () => {
    const builds = [
      build({ github_path: "checkout", id: "b1", name: "checkout" }),
      build({ github_path: "legacy", id: "b2" }),
    ];
    const plan = planReconcile(["pay", "growth"], builds, new Map([["checkout", "pay"]]));
    expect(plan.renames).toEqual([{ id: "b1", from: "checkout", to: "pay", renameName: true }]);
    expect(plan.creates).toEqual(["growth"]);
    expect(plan.archives).toEqual([{ id: "b2", path: "legacy" }]);
  });
});
