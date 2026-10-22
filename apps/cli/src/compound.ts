import { readFile, stat } from "node:fs/promises";
import { CompoundInputSchema, isRecord, parse, type MoguriSdk } from "../../../packages/sdk/src/index.ts";

interface Options {
  session?: string; project?: string; workspace?: string; digest?: string; revision?: string;
  "confirm-cost"?: boolean; "confirm-stage-and-test"?: boolean; "confirm-review"?: boolean;
}
export async function compoundCommand(sdk: MoguriSdk, action: string | undefined, args: string[], options: Options): Promise<unknown> {
  if (options.project || options.workspace) throw new Error("Public compound input binds its exact source session and two explicitly reviewed owned worktrees. Do not override project/root/workspace flags.");
  if (action === "list" && !args.length) return sdk.compound.list(options.session);
  if (action === "read" && args.length === 1) return sdk.compound.read(args[0]!);
  if (action === "validation" && args.length === 1) return sdk.compound.validationPreview(args[0]!);
  if (action === "stop" && args.length === 1) return sdk.compound.stop(args[0]!);
  if ((action === "preview" || action === "start") && args.length === 1 && options.session) {
    if (action === "start" && (!options.digest || !options["confirm-cost"])) throw new Error("Starting paid roles requires exact --digest and --confirm-cost after reviewing the complete input.");
    const metadata = await stat(args[0]!);
    if (!metadata.isFile() || metadata.size > 32 * 1024) throw new Error("Select a regular compound-selection JSON file no larger than 32 KiB.");
    const bytes = await readFile(args[0]!);
    if (bytes.byteLength > 32 * 1024) throw new Error("Compound selection grew beyond lossless 32-KiB JSON. Nothing was truncated.");
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const value: unknown = JSON.parse(text);
    if (!isRecord(value) || Object.hasOwn(value, "sessionId")) throw new Error("--session binds the exact current owner. Do not include session/profile/root/actor overrides in selection JSON.");
    const input = parse(CompoundInputSchema, { ...value, sessionId: options.session });
    return action === "preview" ? sdk.compound.preview(input) : sdk.compound.start(input, options.digest!, true);
  }
  if ((action === "review" || action === "deny") && args.length === 2 && options.digest && options.revision && /^\d+$/.test(options.revision)) {
    if (action === "review" && !options["confirm-stage-and-test"]) throw new Error("Staging and real command execution need --confirm-stage-and-test after reviewing exact candidate bytes/root and the configured command.");
    if (action === "deny" && !options["confirm-review"]) throw new Error("Use --confirm-review for this exact explicit validation denial.");
    return sdk.compound.review(args[0]!, args[1]!, Number(options.revision), options.digest, action === "review");
  }
  throw new Error("Use compound list/read/stop ID, preview INPUT.json --session ID, start INPUT.json --session ID --digest SHA --confirm-cost, or review/deny ID VALIDATION --revision N --digest SHA with --confirm-stage-and-test/--confirm-review.");
}
