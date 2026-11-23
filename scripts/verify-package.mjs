// Installs the packed @moguri-dev/tui in a throwaway consumer and checks what a user actually gets.
// Usage: node scripts/verify-package.mjs [path/to/moguri-dev-tui-<version>.tgz]
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const temporary = await mkdtemp(join(tmpdir(), "moguri-tui-consumer-"));
try {
  // The prepack build would print into npm pack's JSON, so build first and pack without lifecycle scripts.
  if (!process.argv[2]) execFileSync("npm", ["run", "--silent", "build"], { stdio: ["ignore", "inherit", "inherit"] });
  const archive = process.argv[2] ? resolve(process.argv[2]) :
    join(temporary, JSON.parse(execFileSync("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", temporary], { encoding: "utf8" }))[0].filename);
  const listed = execFileSync("tar", ["-tzf", archive], { encoding: "utf8" }).trim().split("\n").map((path) => path.replace(/^package\//, ""));
  const unexpected = listed.filter((path) => !/^(bin\/|dist\/|docs\/third-party\.md$|LICENSE\.md$|README\.md$|package\.json$)/.test(path));
  assert.deepEqual(unexpected, [], "The package must ship only the launcher, built bundles, notices, license, README and manifest.");
  for (const path of ["bin/moguri.mjs", "dist/cli.mjs", "dist/tui.mjs", "dist/THIRD_PARTY_NOTICES.md", "LICENSE.md"]) assert.ok(listed.includes(path), `The package is missing ${path}.`);

  const consumer = join(temporary, "consumer");
  execFileSync("mkdir", [consumer]);
  // The scope mapping only; the token comes from the user's npm config or NODE_AUTH_TOKEN, never from a file here.
  await writeFile(join(consumer, ".npmrc"), "@moguri-dev:registry=https://npm.pkg.github.com\n");
  await writeFile(join(consumer, "package.json"), JSON.stringify({
    name: "generated-moguri-tui-consumer", private: true, type: "module",
    dependencies: { [manifest.name]: `file:${archive}` }, allowScripts: { ...manifest.allowScripts, [manifest.name]: true },
  }));
  execFileSync("npm", ["install", "--no-audit", "--no-fund", "--no-progress"], { cwd: consumer, stdio: "inherit" });
  execFileSync("npm", ["audit", "--audit-level=moderate"], { cwd: consumer, stdio: "inherit" });

  const run = (command, args) => spawnSync(command, args, { cwd: consumer, encoding: "utf8", env: { ...process.env, MOGURI_STATE_DIR: join(temporary, "state") }, timeout: 30_000 });
  const cli = run(join(consumer, "node_modules", ".bin", "moguri"), ["--help"]);
  assert.equal(cli.status, 0, cli.stderr); assert.match(cli.stdout, /Moguri CLI \+ SDK/);
  const tui = run(process.execPath, [join(consumer, "node_modules", manifest.name, "dist", "tui.mjs"), "--help"]);
  assert.equal(tui.status, 0, tui.stderr); assert.match(tui.stdout, /Moguri TUI/);
  // Outside a desktop source checkout, moguri desktop refuses instead of guessing an app location.
  const desktop = run(join(consumer, "node_modules", ".bin", "moguri"), ["desktop"]);
  assert.notEqual(desktop.status, 0); assert.match(desktop.stderr, /runs only from a Moguri desktop source checkout/);
  // Embedders such as the desktop app run commands through the ./cli entry.
  const embedded = run(process.execPath, ["--input-type=module", "--eval", `const { run } = await import("${manifest.name}/cli"); await run(["--help"]);`]);
  assert.equal(embedded.status, 0, embedded.stderr); assert.match(embedded.stdout, /Moguri CLI \+ SDK/);
  // moguri worker --stdio delegates to the SDK's remote bridge, which must be installed with it.
  await access(join(consumer, "node_modules", "@moguri-dev", "sdk", "dist", "remote-bridge.mjs"));
  console.log(`Verified ${manifest.name}@${manifest.version}: ${listed.length} packed files, CLI, TUI, desktop refusal and remote bridge.`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
