import { build } from "esbuild";
import { mkdir, rm } from "node:fs/promises";
import { writeThirdPartyNotices } from "./third-party-notices.mjs";

await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });
const bundle = (options) => build({ ...options, metafile: true });
// Dependencies stay external: the service, runtime and workers ship in the installed @moguri-dev/sdk package.
const nodeBuild = { bundle: true, platform: "node", format: "esm", target: "node26", packages: "external" };
const bundled = await Promise.all([
  bundle({ ...nodeBuild, entryPoints: ["apps/cli/src/main.ts"], outfile: "dist/cli.mjs" }),
  bundle({ ...nodeBuild, entryPoints: ["apps/tui/src/main.tsx"], outfile: "dist/tui.mjs", jsx: "automatic", jsxImportSource: "@opentui/react" }),
]);
const bundledIds = bundled.flatMap((result) => Object.keys(result.metafile.inputs));
const notices = await writeThirdPartyNotices(bundledIds, "dist/THIRD_PARTY_NOTICES.md");
console.log(`Third-party notices: ${notices.length} bundled packages in dist/THIRD_PARTY_NOTICES.md.`);
console.log("Built the moguri CLI and TUI against the installed @moguri-dev/sdk.");
