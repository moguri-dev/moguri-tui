import { build } from "esbuild";
import { build as viteBuild } from "vite";
import { chmod, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { prepareSpeech } from "./prepare-speech.mjs";
import { buildIcons } from "./build-icons.mjs";
import { bundledCliLauncher } from "../apps/desktop/src/cli-installation.ts";
import { buildCache, cacheImports } from "./build-cache.mjs";
import { dirname, relative, sep } from "node:path";

await rm("dist", { recursive: true, force: true });
await mkdir("dist/desktop", { recursive: true });
await writeFile("dist/moguri", bundledCliLauncher(), { mode: 0o755 });
await chmod("dist/moguri", 0o755);
const speech = await prepareSpeech();
await cp(new URL("../.native/speech", import.meta.url), "dist/native/speech", { recursive: true });
const version = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")).version;
const define = { __MOGURI_BUILD_VERSION__: JSON.stringify(version) };
await buildCache();
const nodeSdkImports = {
  name: "moguri-node-sdk-location",
  setup(build) {
    build.onResolve({ filter: /\/packages\/sdk\/src\/node\.ts$/ }, ({ kind }) => {
      if (kind === "entry-point") return;
      // Node SDK runtime paths belong to dist/sdk, not an inlining client's import.meta.url.
      const path = relative(dirname(build.initialOptions.outfile), "dist/sdk/node.mjs").split(sep).join("/");
      return { path: path.startsWith(".") ? path : `./${path}`, external: true };
    });
  },
};
const nodeBuild = { bundle: true, platform: "node", format: "esm", target: "node26", packages: "external", define, plugins: [cacheImports, nodeSdkImports] };
await Promise.all([
  build({ ...nodeBuild, entryPoints: ["apps/service/src/main.ts"], outfile: "dist/service.mjs" }),
  build({ ...nodeBuild, entryPoints: ["apps/service/src/update-installer.ts"], outfile: "dist/update-installer.mjs", packages: "bundle" }),
  build({ ...nodeBuild, entryPoints: ["apps/service/src/bundle-tree.ts"], outfile: "dist/update-tools.mjs" }),
  build({ ...nodeBuild, entryPoints: ["apps/service/src/sandbox-distribution.ts"], outfile: "dist/sandbox-tools.mjs" }),
  build({ ...nodeBuild, entryPoints: ["apps/service/src/server.ts"], outfile: "dist/runtime.mjs" }),
  build({ entryPoints: ["apps/service/src/worker.ts"], outfile: "dist/worker.mjs", bundle: true, platform: "node", format: "esm", target: "node26", packages: "external", plugins: [cacheImports] }),
  build({ ...nodeBuild, entryPoints: ["apps/service/src/mcp-worker.ts"], outfile: "dist/mcp-worker.mjs" }),
  build({ ...nodeBuild, entryPoints: ["apps/service/src/remote-bridge.ts"], outfile: "dist/remote-bridge.mjs" }),
  build({ ...nodeBuild, entryPoints: ["apps/service/src/terminal-broker.ts"], outfile: "dist/terminal-broker.mjs" }),
  build({ ...nodeBuild, entryPoints: ["apps/service/src/terminal-bridge.ts"], outfile: "dist/terminal-bridge.mjs" }),
  build({ ...nodeBuild, entryPoints: ["apps/service/src/document-worker.ts"], outfile: "dist/document-worker.mjs" }),
  build({ ...nodeBuild, entryPoints: ["apps/service/src/data-worker.ts"], outfile: "dist/data-worker.mjs" }),
  build({ ...nodeBuild, entryPoints: ["apps/service/src/playwright-worker.ts"], outfile: "dist/playwright-worker.mjs" }),
  build({ ...nodeBuild, entryPoints: ["apps/service/src/speech-host.ts"], outfile: "dist/speech-host.mjs" }),
  build({ ...nodeBuild, entryPoints: ["apps/cli/src/main.ts"], outfile: "dist/cli.mjs" }),
  build({ entryPoints: ["packages/sdk/src/index.ts"], outfile: "dist/sdk/index.mjs", bundle: true, platform: "browser", format: "esm", target: "es2024", packages: "external" }),
  build({ ...nodeBuild, entryPoints: ["packages/sdk/src/node.ts"], outfile: "dist/sdk/node.mjs" }),
  build({ ...nodeBuild, entryPoints: ["packages/sdk/src/mcp-server.ts"], outfile: "dist/sdk/mcp.mjs" }),
  build({ entryPoints: ["packages/sdk/src/react.ts"], outfile: "dist/sdk/react.mjs", bundle: true, platform: "browser", format: "esm", target: "es2024", packages: "external" }),
  build({ entryPoints: ["apps/tui/src/main.tsx"], outfile: "dist/tui.mjs", bundle: true, platform: "node", format: "esm", target: "node26", packages: "external", plugins: [nodeSdkImports], jsx: "automatic", jsxImportSource: "@opentui/react" }),
  build({ entryPoints: ["apps/desktop/src/main.ts"], outfile: "dist/desktop/main.mjs", bundle: true, platform: "node", format: "esm", target: "node26", packages: "external", plugins: [nodeSdkImports] }),
  build({ entryPoints: ["apps/desktop/src/preload.ts"], outfile: "dist/desktop/preload.cjs", bundle: true, platform: "node", format: "cjs", target: "node26", external: ["electron"] }),
  build({ entryPoints: ["apps/desktop/src/html-preload.ts"], outfile: "dist/desktop/html-preload.cjs", bundle: true, platform: "browser", format: "cjs", target: "es2024" }),
  viteBuild({ configFile: "apps/desktop/vite.config.ts" }),
  buildIcons(),
]);
execFileSync("node_modules/.bin/tsc", ["-p", "tsconfig.sdk.json"], { stdio: "inherit" });
console.log(`Built shared SDK/types, CLI/exec launcher, service/workers, TUI and desktop. Pinned local speech runtime: ${speech}. No model weights downloaded.`);
