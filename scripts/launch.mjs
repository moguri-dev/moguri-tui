import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { access } from "node:fs/promises";
import { resolve } from "node:path";

const require = createRequire(import.meta.url);
const [target = "tui", ...args] = process.argv.slice(2);
if (!["tui", "desktop", "service"].includes(target)) throw new Error("Choose tui, desktop, or service.");
await access(resolve("dist/service.mjs")).catch(() => { throw new Error("Build Moguri first with npm run build."); });
const runtime = target === "desktop" ? (await import("electron")).default : require.resolve("node/bin/node");
const child = spawn(runtime, [target === "desktop" ? "." : resolve(`dist/${target}.mjs`), ...args], { stdio: "inherit" });
child.on("error", (error) => { console.error(`Moguri ${target} could not start: ${error.message}`); process.exitCode = 1; });
child.on("exit", (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
process.on("SIGTERM", () => child.kill("SIGTERM"));
