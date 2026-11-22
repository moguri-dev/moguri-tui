import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { RemoteTarget } from "@moguri-dev/sdk/testing";
import { generatedRepositoryMetadata } from "./repository-info.ts";
import { sdkPath } from "./sdk-paths.ts";

export async function generatedRemoteGithub(directory: string, target: RemoteTarget, options: { bridge?: string; node?: string } = {}) {
  const bin = join(directory, "generated-gh-bin"), home = join(directory, "generated-gh-home");
  await mkdir(bin, { recursive: true }); await mkdir(home, { recursive: true });
  const configuration = join(directory, "generated-gh.json"), calls = join(directory, "generated-gh-calls.jsonl");
  const witness = join(directory, "generated-gh-pid"), stopped = join(directory, "generated-gh-stopped"), ready = join(directory, "generated-gh-ready"), release = join(directory, "generated-gh-release");
  const program = join(bin, "generated-gh.mjs"), front = join(directory, "generated-gh-front.mjs");
  await writeFile(configuration, JSON.stringify({ mode: "success", reply: { ...generatedRepositoryMetadata(), private: true, visibility: "private" } }));
  await writeFile(program, `
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
const config = JSON.parse(readFileSync(${JSON.stringify(configuration)}, "utf8"));
appendFileSync(${JSON.stringify(calls)}, JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd(), home: process.env.HOME, pid: process.pid }) + "\\n");
writeFileSync(${JSON.stringify(witness)}, String(process.pid));
process.once("exit", () => writeFileSync(${JSON.stringify(stopped)}, "generated process exited"));
if (config.mode === "error") { process.stderr.write("GENERATED_GH_PRIVATE_DIAGNOSTIC"); process.exitCode = 1; }
else if (config.mode === "malformed") process.stdout.write("{");
else if (config.mode === "oversize") process.stdout.write("x".repeat(2 * 1024 * 1024 + 1));
else if (config.mode === "hold") { process.on("SIGTERM", () => {}); setInterval(() => {}, 1000); writeFileSync(${JSON.stringify(ready)}, String(process.pid)); }
else if (config.mode === "gate") { const timer = setInterval(() => { if (existsSync(${JSON.stringify(release)})) { clearInterval(timer); process.stdout.write(JSON.stringify(config.reply)); } }, 15); writeFileSync(${JSON.stringify(ready)}, String(process.pid)); }
else process.stdout.write(JSON.stringify(config.reply));
`);
  const node = options.node ?? process.execPath;
  await writeFile(join(bin, "gh"), `#!/bin/sh\nexec '${node.replaceAll("'", "'\\''")}' '${program.replaceAll("'", "'\\''")}' "$@"\n`, { mode: 0o700 });
  await writeFile(join(bin, "git"), '#!/bin/sh\nexec /usr/bin/git "$@"\n', { mode: 0o700 });
  await writeFile(front, `
process.env.HOME = ${JSON.stringify(home)};
process.env.PATH = ${JSON.stringify(bin)};
await import(process.argv.includes("--repository-probe") ? ${JSON.stringify(pathToFileURL(resolve("tests/fixtures/remote-repository-probe.ts")).href)} : ${JSON.stringify(pathToFileURL(options.bridge ?? sdkPath("dist/remote-bridge.mjs")).href)});
`);
  return {
    target: { ...target, command: options.bridge ? [node, front] : [node, "--import", pathToFileURL(resolve("node_modules/tsx/dist/loader.mjs")).href, front] },
    bin, home, calls, witness, stopped, ready,
    configure: (mode: "success" | "error" | "malformed" | "oversize" | "hold" | "gate", reply: unknown = { ...generatedRepositoryMetadata(), private: true, visibility: "private" }) => writeFile(configuration, JSON.stringify({ mode, reply })),
    release: () => writeFile(release, "Generated explicit metadata release."),
    records: async () => (await readFile(calls, "utf8")).trim().split("\n").map((line) => JSON.parse(line) as { args: string[]; cwd: string; home: string; pid: number }),
  };
}

export async function forbidControllerGithub(directory: string) {
  const bin = join(directory, "generated-forbidden-controller-bin"), marker = join(directory, "generated-controller-gh-ran");
  await mkdir(bin);
  await writeFile(join(bin, "gh"), `#!/bin/sh\nprintf generated >> '${marker.replaceAll("'", "'\\''")}'\nexit 70\n`, { mode: 0o700 });
  const before = process.env.PATH;
  process.env.PATH = `${bin}:${before ?? ""}`;
  return { marker, restore: () => { if (before === undefined) delete process.env.PATH; else process.env.PATH = before; } };
}
