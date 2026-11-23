#!/usr/bin/env node
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
// Inside the Moguri app, the pinned Node runtime package sits beside this one. A standalone install runs on the
// current Node, which package.json engines already constrains.
let runtime = process.execPath;
try { runtime = require.resolve("node/bin/node"); }
catch (error) { if (error?.code !== "MODULE_NOT_FOUND") throw error; }
const worker = process.argv[2] === "worker";
const entrypoint = worker ? new URL(import.meta.resolve("@moguri-dev/sdk/remote-bridge")) : new URL("../dist/cli.mjs", import.meta.url);
const args = process.argv.slice(worker ? 3 : 2);
if (process.execPath === runtime) {
  if (worker) await import(entrypoint.href);
  else { const { main } = await import(entrypoint.href); await main(args); }
} else {
  const child = spawn(runtime, [fileURLToPath(entrypoint), ...args], { stdio: "inherit" });
  process.on("SIGINT", () => {});
  process.on("SIGTERM", () => child.kill("SIGTERM"));
  child.on("error", (error) => { console.error(error.message); process.exitCode = 1; });
  child.on("exit", (code) => { process.exitCode = code ?? 1; });
}
