import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { access } from "node:fs/promises";
import { resolve } from "node:path";

const require = createRequire(import.meta.url);
const [target = "tui", ...args] = process.argv.slice(2);
if (!["tui", "service"].includes(target)) throw new Error("Choose tui or service.");
await access(resolve("dist/tui.mjs")).catch(() => { throw new Error("Build the TUI first with npm run build."); });
// The local service ships inside the installed @moguri-dev/sdk package.
const entry = target === "service" ? resolve(require.resolve("@moguri-dev/sdk/package.json"), "../dist/service.mjs") : resolve("dist/tui.mjs");
const child = spawn(require.resolve("node/bin/node"), [entry, ...args], { stdio: "inherit" });
child.on("error", (error) => { console.error(`Moguri ${target} could not start: ${error.message}`); process.exitCode = 1; });
child.on("exit", (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
process.on("SIGTERM", () => child.kill("SIGTERM"));
