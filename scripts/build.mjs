import { build } from "esbuild";
import { build as viteBuild } from "vite";
import { mkdir, rm } from "node:fs/promises";

await rm("dist", { recursive: true, force: true });
await mkdir("dist/desktop", { recursive: true });
await Promise.all([
  build({ entryPoints: ["apps/service/src/main.ts"], outfile: "dist/service.mjs", bundle: true, platform: "node", format: "esm", target: "node26", packages: "external" }),
  build({ entryPoints: ["apps/service/src/worker.ts"], outfile: "dist/worker.mjs", bundle: true, platform: "node", format: "esm", target: "node26", packages: "external" }),
  build({ entryPoints: ["apps/tui/src/main.tsx"], outfile: "dist/tui.mjs", bundle: true, platform: "node", format: "esm", target: "node26", packages: "external", jsx: "automatic", jsxImportSource: "@opentui/react" }),
  build({ entryPoints: ["apps/desktop/src/main.ts"], outfile: "dist/desktop/main.mjs", bundle: true, platform: "node", format: "esm", target: "node26", packages: "external" }),
  build({ entryPoints: ["apps/desktop/src/preload.ts"], outfile: "dist/desktop/preload.cjs", bundle: true, platform: "node", format: "cjs", target: "node26", external: ["electron"] }),
  viteBuild({ configFile: "apps/desktop/vite.config.ts" }),
]);
console.log("Built shared service, worker, OpenTUI client and Electron desktop.");
