import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

const require = createRequire(import.meta.url);
const [target = "tui", ...args] = process.argv.slice(2);
if (!["tui", "desktop", "service"].includes(target)) throw new Error("Choose tui, desktop, or service.");
await access(resolve("dist/cli.mjs")).catch(() => { throw new Error("Build Moguri first with npm run build."); });
const runtime = target === "desktop" ? (await import("electron")).default : require.resolve("node/bin/node");
const profile = target === "desktop" ? parseArgs({ args, strict: false, allowPositionals: true, options: { profile: { type: "string" } } }).values.profile : undefined;
// The local service ships inside the installed @moguri-dev/sdk package.
const entry = target === "desktop" ? "." : target === "service" ? resolve(require.resolve("@moguri-dev/sdk/package.json"), "../dist/service.mjs") : resolve(`dist/${target}.mjs`);
const child = spawn(runtime, [entry, ...args], { stdio: "inherit", env: { ...process.env, ...(profile ? { MOGURI_PROFILE_ID: profile } : {}) } });
child.on("error", (error) => { console.error(`Moguri ${target} could not start: ${error.message}`); process.exitCode = 1; });
child.on("exit", (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
process.on("SIGTERM", () => child.kill("SIGTERM"));
