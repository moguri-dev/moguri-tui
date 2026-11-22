import { readFile, stat } from "node:fs/promises";
import { DecisionSettingsSchema, parse, type MoguriSdk } from "@moguri-dev/sdk";

export async function decisionCommand(sdk: MoguriSdk, action: string | undefined, args: string[], options: {
  session?: string; project?: string; workspace?: string; "confirm-review"?: boolean;
}): Promise<unknown> {
  if (options.project || options.workspace) throw new Error("Decision scope comes from its actual retained parent session and source; do not override a root or workspace.");
  if (action === "status" && options.session && !args.length) return sdk.decisions.status(options.session);
  if (action === "list" && !args.length) return sdk.decisions.list(options.session);
  if (action === "read" && args.length === 1) return sdk.decisions.read(args[0]!);
  if (action === "stop" && args.length === 1) return sdk.decisions.stop(args[0]!);
  if (action === "set" && args.length === 1) {
    if (!options["confirm-review"]) throw new Error("Explicit decision-provider configuration requires --confirm-review. No model, authority or inference was changed.");
    const file = args[0]!, metadata = await stat(file);
    if (!metadata.isFile() || metadata.size > 128 * 1024) throw new Error("Choose a regular exact decision policy JSON file up to 128 KiB.");
    const bytes = await readFile(file);
    if (bytes.byteLength > 128 * 1024) throw new Error("Decision policy grew beyond 128 KiB. No prefix was adopted.");
    const policy = parse(DecisionSettingsSchema, JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes))), settings = sdk.settings.get();
    if (!settings) throw new Error("Connect to the exact immutable profile before reviewing a decision policy.");
    return sdk.settings.update({ ...settings.values, decisions: policy }, settings.revision);
  }
  throw new Error("Use decisions status --session ID, list [--session ID], read ID, stop ID or set POLICY.json --confirm-review. These commands cannot run a decision, answer, approve or steer.");
}
