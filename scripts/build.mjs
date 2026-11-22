import { build } from "esbuild";
import { build as viteBuild } from "vite";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { buildIcons } from "./build-icons.mjs";
import { bundledCliLauncher } from "../apps/desktop/src/cli-installation.ts";
import { writeThirdPartyNotices } from "./third-party-notices.mjs";

await rm("dist", { recursive: true, force: true });
await mkdir("dist/desktop", { recursive: true });
await writeFile("dist/moguri", bundledCliLauncher(), { mode: 0o755 });
await chmod("dist/moguri", 0o755);
const version = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")).version;
const define = { __MOGURI_BUILD_VERSION__: JSON.stringify(version) };
const bundle = (options) => build({ ...options, metafile: true });
// The service, runtime and workers ship inside the installed @moguri-dev/sdk package; clients bundle only their own code.
const nodeBuild = { bundle: true, platform: "node", format: "esm", target: "node26", packages: "external", define };
const bundled = await Promise.all([
  bundle({ ...nodeBuild, entryPoints: ["apps/cli/src/main.ts"], outfile: "dist/cli.mjs" }),
  bundle({ ...nodeBuild, entryPoints: ["apps/tui/src/main.tsx"], outfile: "dist/tui.mjs", jsx: "automatic", jsxImportSource: "@opentui/react" }),
  bundle({ ...nodeBuild, entryPoints: ["apps/desktop/src/main.ts"], outfile: "dist/desktop/main.mjs" }),
  bundle({ entryPoints: ["apps/desktop/src/preload.ts"], outfile: "dist/desktop/preload.cjs", bundle: true, platform: "node", format: "cjs", target: "node26", external: ["electron"] }),
  bundle({ entryPoints: ["apps/desktop/src/html-preload.ts"], outfile: "dist/desktop/html-preload.cjs", bundle: true, platform: "browser", format: "cjs", target: "es2024" }),
  viteBuild({ configFile: "apps/desktop/vite.config.ts" }),
  buildIcons(),
]);
const bundledIds = bundled.flatMap((result) => [
  ...Object.keys(result?.metafile?.inputs ?? {}),
  ...[result].flat().flatMap((output) => output?.output ?? []).flatMap((chunk) => chunk.moduleIds ?? Object.keys(chunk.modules ?? {})),
]);
const notices = await writeThirdPartyNotices(bundledIds, "dist/THIRD_PARTY_NOTICES.md");
console.log(`Third-party notices: ${notices.length} bundled packages in dist/THIRD_PARTY_NOTICES.md.`);
console.log("Built the CLI/exec launcher, TUI and desktop against the installed @moguri-dev/sdk.");
