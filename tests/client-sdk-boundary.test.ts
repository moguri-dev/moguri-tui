import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const clients = ["apps/desktop/src", "apps/tui/src", "apps/cli/src"];
// Product code uses the supported entrypoints only; "@moguri-dev/sdk/testing" is test support without compatibility promises.
const entrypoints = new Set(["@moguri-dev/sdk", "@moguri-dev/sdk/node", "@moguri-dev/sdk/react", "@moguri-dev/sdk/mcp", "@moguri-dev/sdk/remote-bridge"]);
const specifiers = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)["']([^"']+)["']/g;

async function sources(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true, recursive: true });
  return entries.filter((entry) => entry.isFile() && /\.(?:mts|ts|tsx)$/.test(entry.name)).map((entry) => join(entry.parentPath, entry.name));
}

test("desktop, TUI and CLI reach the SDK only through its supported package entrypoints", async () => {
  const violations: string[] = [];
  for (const client of clients) for (const file of await sources(join(root, client))) {
    for (const [, specifier] of (await readFile(file, "utf8")).matchAll(specifiers)) {
      if (specifier!.startsWith("@moguri-dev/sdk") && !entrypoints.has(specifier!)) violations.push(`${relative(root, file)} -> ${specifier}`);
    }
  }
  assert.deepEqual(violations, [], "Import @moguri-dev/sdk, /node, /react, /mcp or /remote-bridge; never /testing or package internals.");
});
