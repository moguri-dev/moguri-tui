import { spawn } from "node:child_process";
import type { TuiNativeActions } from "./App.tsx";
import { saveArtifactExport } from "@moguri-dev/sdk/node";

async function invoke(command: string, args: string[], input?: string): Promise<void> {
  if (process.platform !== "darwin") throw new Error("Default application and clipboard bindings are currently qualified only on macOS.");
  const child = spawn(command, args, { stdio: ["pipe", "ignore", "pipe"] });
  let error = "";
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => { error = (error + chunk).slice(-4096); });
  await new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.stdin.once("error", reject);
    child.once("exit", (code, signal) => code === 0 ? resolve() : reject(new Error(`${command} failed (${signal ?? code}): ${error.trim() || "the operating system did not acknowledge the action"}`)));
    child.stdin.end(input);
  });
}
export const nativeActions: TuiNativeActions = {
  browser: async (url) => {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("Only HTTP(S) browser URLs are supported.");
    await invoke("open", [parsed.href]);
  },
  file: (path) => invoke("open", [path]),
  copy: (text) => invoke("pbcopy", [], text),
  saveExport: saveArtifactExport,
};
