import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import spdx from "spdx-license-list";

const licenseFile = /^(?:licen[cs]e|copying|notice)(?:[-._].*)?$/i;

// Maps bundler module IDs (esbuild metafile inputs, Rolldown module IDs) to the installed package directories they came from.
export function packageRoots(ids, base = process.cwd()) {
  const roots = new Set();
  for (const id of ids) {
    const clean = String(id).replace(/^\0+/, "").split("?")[0];
    if (!clean.includes("node_modules")) continue;
    const parts = resolve(base, clean).split(sep), index = parts.lastIndexOf("node_modules");
    if (index < 0) continue;
    const scoped = parts[index + 1]?.startsWith("@"), end = index + (scoped ? 3 : 2);
    if (parts.length < end) continue;
    roots.add(parts.slice(0, end).join(sep));
  }
  return [...roots].sort();
}

function declaredLicense(metadata) {
  if (typeof metadata.license === "string") return metadata.license;
  if (metadata.license && typeof metadata.license.type === "string") return metadata.license.type;
  if (Array.isArray(metadata.licenses)) return metadata.licenses.map((entry) => entry?.type ?? entry).filter((entry) => typeof entry === "string").join(" OR ") || "UNKNOWN";
  return "UNKNOWN";
}

export function isOpenSourceLicense(expression) {
  const ids = expression.split(/\s+(?:OR|AND|WITH)\s+|[()]/).map((id) => id.trim().replace(/\+$/, "")).filter(Boolean);
  return ids.length > 0 && ids.every((id) => spdx[id]?.osiApproved === true);
}

export async function collectNotices(roots) {
  const entries = new Map();
  for (const root of roots) {
    const metadata = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
    // Moguri's own packages (the @moguri-dev scope, such as the SDK) are covered by LICENSE.md, not third-party notices.
    if (typeof metadata.name === "string" && metadata.name.startsWith("@moguri-dev/")) continue;
    const key = `${metadata.name}@${metadata.version}`;
    if (entries.has(key)) continue;
    const files = (await readdir(root, { withFileTypes: true })).filter((entry) => entry.isFile() && licenseFile.test(entry.name)).map((entry) => entry.name).sort();
    const texts = [];
    for (const name of files) texts.push({ name, text: (await readFile(join(root, name), "utf8")).trim() });
    const license = declaredLicense(metadata);
    entries.set(key, { name: metadata.name, version: metadata.version, license, openSource: isOpenSourceLicense(license), texts });
  }
  return [...entries.values()].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
}

export function renderNotices(entries) {
  const restricted = entries.filter((entry) => !entry.openSource);
  const lines = [
    "# Third-party notices", "",
    "Moguri's own code is licensed under the MIT License (`LICENSE.md`). The build bundles the third-party packages below into Moguri's JavaScript files.",
    "Each package remains under its own license, reproduced here. The MIT License does not relicense any of them.",
    "Packages shipped unbundled in the app's `node_modules`, including the Moguri SDK's own notices and native speech runtimes, keep their own license files in place.", "",
  ];
  if (restricted.length) {
    lines.push("## Components without an OSI-approved license", "",
      "The following bundled components are not under an OSI-approved open-source license. Their own terms, reproduced below, govern their use and redistribution.", "");
    for (const entry of restricted) lines.push(`- \`${entry.name}\` ${entry.version}: ${entry.license}`);
    lines.push("");
  }
  for (const entry of entries) {
    lines.push(`## ${entry.name} ${entry.version}`, "", `License: ${entry.license}`, "");
    if (!entry.texts.length) lines.push("The package ships no license file; its declared license is shown above.", "");
    for (const { name, text } of entry.texts) {
      const fence = text.includes("````") ? "`````" : "````";
      lines.push(`${name}:`, "", `${fence}text`, text, fence, "");
    }
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

export async function writeThirdPartyNotices(ids, outfile, base = process.cwd()) {
  const entries = await collectNotices(packageRoots(ids, base));
  await writeFile(outfile, renderNotices(entries));
  return entries;
}
