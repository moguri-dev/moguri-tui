import { build } from "esbuild";
import { build as viteBuild } from "vite";
import { cp, mkdir, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { prepareSpeech } from "./prepare-speech.mjs";
import { buildIcons } from "./build-icons.mjs";

await rm("dist", { recursive: true, force: true });
await mkdir("dist/desktop", { recursive: true });
const speech = await prepareSpeech();
await cp(new URL("../.native/speech", import.meta.url), "dist/native/speech", { recursive: true });
const nodeBuild = { bundle: true, platform: "node", format: "esm", target: "node26", packages: "external" };
await Promise.all([
  build({ entryPoints: ["apps/service/src/main.ts"], outfile: "dist/service.mjs", bundle: true, platform: "node", format: "esm", target: "node26", packages: "external" }),
  build({ entryPoints: ["apps/service/src/worker.ts"], outfile: "dist/worker.mjs", bundle: true, platform: "node", format: "esm", target: "node26", packages: "external" }),
  build({ ...nodeBuild, entryPoints: ["apps/service/src/mcp-worker.ts"], outfile: "dist/mcp-worker.mjs" }),
  build({ ...nodeBuild, entryPoints: ["apps/service/src/remote-bridge.ts"], outfile: "dist/remote-bridge.mjs" }),
  build({ ...nodeBuild, entryPoints: ["apps/service/src/terminal-broker.ts"], outfile: "dist/terminal-broker.mjs" }),
  build({ ...nodeBuild, entryPoints: ["apps/cli/src/main.ts"], outfile: "dist/cli.mjs" }),
  build({ entryPoints: ["packages/sdk/src/index.ts"], outfile: "dist/sdk/index.mjs", bundle: true, platform: "browser", format: "esm", target: "es2024", packages: "external" }),
  build({ ...nodeBuild, entryPoints: ["packages/sdk/src/node.ts"], outfile: "dist/sdk/node.mjs" }),
  build({ ...nodeBuild, entryPoints: ["packages/sdk/src/mcp-server.ts"], outfile: "dist/sdk/mcp.mjs" }),
  build({ entryPoints: ["packages/sdk/src/react.ts"], outfile: "dist/sdk/react.mjs", bundle: true, platform: "browser", format: "esm", target: "es2024", packages: "external" }),
  build({ entryPoints: ["apps/tui/src/main.tsx"], outfile: "dist/tui.mjs", bundle: true, platform: "node", format: "esm", target: "node26", packages: "external", jsx: "automatic", jsxImportSource: "@opentui/react" }),
  build({ entryPoints: ["apps/desktop/src/main.ts"], outfile: "dist/desktop/main.mjs", bundle: true, platform: "node", format: "esm", target: "node26", packages: "external" }),
  build({ entryPoints: ["apps/desktop/src/preload.ts"], outfile: "dist/desktop/preload.cjs", bundle: true, platform: "node", format: "cjs", target: "node26", external: ["electron"] }),
  viteBuild({ configFile: "apps/desktop/vite.config.ts" }),
  buildIcons(),
]);
execFileSync("node_modules/.bin/tsc", ["-p", "tsconfig.sdk.json"], { stdio: "inherit" });
console.log(`Built shared SDK/types, CLI, service/workers, TUI and desktop. Pinned local speech runtime: ${speech}. No model weights downloaded.`);
