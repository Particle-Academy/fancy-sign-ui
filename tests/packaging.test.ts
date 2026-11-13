import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * What this package drags into a consumer's tree, and the entry split.
 *
 * `npm test` runs `tsup` first (the `pretest` script), so the `dist/` assertions
 * below are real. A packaging test that skips when the build is missing never
 * runs in the one situation it exists for.
 */
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
  dependencies?: Record<string, string>;
  peerDependencies: Record<string, string>;
};

function readDist(file: string): string {
  const path = join(root, "dist", file);
  if (!existsSync(path)) {
    throw new Error(`dist/${file} is missing. Run \`npm run build\` (or \`npm test\`, which builds first).`);
  }
  return readFileSync(path, "utf8");
}

/** Follow the ESM entry's relative imports, since tsup code-splits shared chunks. */
function readEntryGraph(entry: string): string {
  const seen = new Set<string>();
  const parts: string[] = [];
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.shift()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const text = readDist(file);
    parts.push(text);
    for (const match of text.matchAll(/from\s*["']\.\/([^"']+)["']/g)) {
      queue.push(match[1]!);
    }
  }
  return parts.join("\n");
}

describe("packaging", () => {
  it("has no runtime dependencies at all", () => {
    expect(Object.keys(pkg.dependencies ?? {})).toEqual([]);
  });

  it("declares react-fancy, react and react-dom as peers", () => {
    for (const peer of ["react", "react-dom", "@particle-academy/react-fancy"]) {
      expect(pkg.peerDependencies[peer]).toBeTruthy();
    }
  });

  it("keeps ./client free of React, so a non-React frontend can use the client", () => {
    const graph = readEntryGraph("client.js");
    expect(graph).not.toMatch(/from\s*["']react["']/);
    expect(graph).not.toMatch(/from\s*["']react\/jsx-runtime["']/);
    expect(graph).not.toMatch(/@particle-academy\/react-fancy/);
  });

  it("never draws an image: no toDataURL or toBlob anywhere in the bundle", () => {
    const graph = readEntryGraph("index.js");
    expect(graph).not.toMatch(/toDataURL|toBlob\(/);
  });
});
