// monorepo.ts — pure helpers for monorepo (folder-as-build) discovery.
//
// Deliberately free of Deno / network / supabase imports so the rename-detection
// and reconcile logic is unit-testable with vitest (monorepo.test.ts). index.ts
// owns the impure parts: GitHub fetches, DB writes, slug generation, events.

export type GhFile = { filename: string; previous_filename?: string; status?: string };

/** Top-level folder of a repo path: "foo/bar/x.ts" → "foo". NULL for root files. */
export function topFolder(path: string): string | null {
  const i = path.indexOf("/");
  return i === -1 ? null : path.slice(0, i);
}

/**
 * Derive folder-level renames (oldTop → newTop) from a GitHub compare's files[].
 * A folder rename surfaces as many file renames that all share the same old/new
 * top-level prefix, so we collapse them to one entry per folder. File renames
 * within the same folder (top unchanged) are ignored.
 */
export function detectFolderRenames(files: GhFile[]): Map<string, string> {
  const renames = new Map<string, string>();
  for (const f of files) {
    if (f.status !== "renamed" || !f.previous_filename) continue;
    const from = topFolder(f.previous_filename);
    const to = topFolder(f.filename);
    if (from && to && from !== to) renames.set(from, to);
  }
  return renames;
}

export type ExistingBuild = { id: string; github_path: string; name: string; is_active: boolean };

export type ReconcilePlan = {
  /** Move a build to a new folder, keeping its id (and tickets). renameName is
   *  true only when the build's name still equals the old folder — i.e. it was
   *  never customized in Jarvis, so it's safe to follow the folder. */
  renames: { id: string; from: string; to: string; renameName: boolean }[];
  /** Re-activate a previously soft-deleted folder-build (folder came back). */
  resurrects: { id: string; path: string; renameName: boolean }[];
  /** Brand-new folders with no matching build → create one each. */
  creates: string[];
  /** Active folder-builds whose folder no longer exists → soft-delete. */
  archives: { id: string; path: string }[];
};

/**
 * Plan the reconcile between the apps repo's current top-level folders and the
 * folder-builds JARVIS already has, applying detected renames first.
 *
 * Pure: returns the set of actions; index.ts executes them. Renames are applied
 * in-memory before create/archive so a `git mv` never looks like delete + add.
 */
export function planReconcile(
  currentFolders: string[],
  builds: ExistingBuild[],
  folderRenames: Map<string, string>,
): ReconcilePlan {
  const plan: ReconcilePlan = { renames: [], resurrects: [], creates: [], archives: [] };

  // Effective path per build after applying renames (id → path), plus the build.
  const byPath = new Map<string, ExistingBuild>();
  for (const b of builds) byPath.set(b.github_path, b);

  // Apply renames in-memory. Only when the source build actually exists; a folder
  // created and renamed between two syncs has no build yet → falls through to create.
  const effective = new Map<string, ExistingBuild>(); // path → build
  const renamedIds = new Set<string>();
  for (const [from, to] of folderRenames) {
    const b = byPath.get(from);
    if (!b) continue;
    plan.renames.push({ id: b.id, from, to, renameName: b.name === from });
    effective.set(to, b);
    renamedIds.add(b.id);
  }
  for (const b of builds) {
    if (renamedIds.has(b.id)) continue;
    effective.set(b.github_path, b);
  }

  const current = new Set(currentFolders);

  // Creates / resurrects: folders present upstream with no active build there.
  for (const folder of currentFolders) {
    const b = effective.get(folder);
    if (!b) {
      plan.creates.push(folder);
    } else if (!b.is_active && !renamedIds.has(b.id)) {
      // Folder reappeared and a soft-deleted build still holds its path.
      plan.resurrects.push({ id: b.id, path: folder, renameName: b.name === folder });
    }
  }

  // Archives: active builds whose folder is gone upstream (and not just renamed).
  for (const [path, b] of effective) {
    if (b.is_active && !current.has(path)) {
      plan.archives.push({ id: b.id, path });
    }
  }

  return plan;
}
