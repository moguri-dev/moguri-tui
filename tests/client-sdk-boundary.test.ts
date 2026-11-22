import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";

const root = resolve(import.meta.dirname, "..");
const clients = ["apps/desktop/src", "apps/tui/src", "apps/cli/src"];
const entrypoints = new Set(["index", "node", "react", "mcp-server"].map((name) => `packages/sdk/src/${name}.ts`));
const internal = ["packages/sdk/", "packages/protocol/", "packages/client/", "apps/service/"];
const specifiers = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)["']([^"']+)["']/g;

async function sources(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true, recursive: true });
  return entries.filter((entry) => entry.isFile() && /\.(?:mts|ts|tsx)$/.test(entry.name)).map((entry) => join(entry.parentPath, entry.name));
}

test("desktop, TUI and CLI reach the SDK only through its public entrypoints", async () => {
  const violations: string[] = [];
  for (const client of clients) for (const file of await sources(join(root, client))) {
    for (const [, specifier] of (await readFile(file, "utf8")).matchAll(specifiers)) {
      if (!specifier!.startsWith(".")) continue;
      const target = relative(root, resolve(dirname(file), specifier!.replace(/\?.*$/, ""))).split(sep).join("/");
      if (internal.some((prefix) => target.startsWith(prefix)) && !entrypoints.has(target)) violations.push(`${relative(root, file)} -> ${target}`);
    }
  }
  assert.deepEqual(violations, [], "Re-export what clients need from packages/sdk/src/{index,node,react,mcp-server}.ts instead.");
});
