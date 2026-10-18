#!/usr/bin/env node
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const runtime = require.resolve("node/bin/node");
if (process.execPath === runtime) {
  const { main } = await import("../dist/cli.mjs");
  await main(process.argv.slice(2));
} else {
  const child = spawn(runtime, [fileURLToPath(new URL("../dist/cli.mjs", import.meta.url)), ...process.argv.slice(2)], { stdio: "inherit" });
  process.on("SIGINT", () => {});
  process.on("SIGTERM", () => child.kill("SIGTERM"));
  child.on("error", (error) => { console.error(error.message); process.exitCode = 1; });
  child.on("exit", (code) => { process.exitCode = code ?? 1; });
}
