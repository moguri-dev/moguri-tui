import { readFile, stat } from "node:fs/promises";
import { isRecord, parse, WinddownCommandSchema, WinddownQuerySchema, type MoguriSdk } from "../../../packages/sdk/src/index.ts";

interface Options {
  session?: string; project?: string; workspace?: string; digest?: string; revision?: string;
  "confirm-git"?: boolean; "confirm-review"?: boolean;
}
export async function winddownCommand(sdk: MoguriSdk, action: string | undefined, args: string[], options: Options): Promise<unknown> {
  if (options.project || options.workspace) throw new Error("Checkpoint scope comes from its original actual source session; do not pass project/workspace/root overrides.");
  if (action === "list" && !args.length) return sdk.winddown.list(options.session);
  if (action === "status" && options.session && !args.length) return sdk.winddown.status(options.session);
  if (action === "read" && args.length === 1) return sdk.winddown.read(args[0]!);
  if (action === "inspect" && args.length === 1) return sdk.winddown.inspectCommit(args[0]!);
  if (action === "reconcile" && args.length === 1 && options.revision && /^\d+$/.test(options.revision) && options.digest && options["confirm-review"]) {
    return sdk.winddown.reconcileCommit(args[0]!, Number(options.revision), options.digest, true);
  }
  if ((action === "source-preview" || action === "source-accept") && args.length >= 2) {
    const [id, ...paths] = args;
    if (action === "source-preview") return sdk.winddown.sourcePreview(id!, paths);
    if (!options["confirm-review"] || !options.digest || !options.revision || !/^\d+$/.test(options.revision)) throw new Error("Separate source acceptance requires exact --revision, --digest and --confirm-review. No Git permission or source was inferred.");
    return sdk.winddown.acceptSource(id!, paths, Number(options.revision), options.digest, true);
  }
  if (action === "stop" && args.length === 1) return sdk.winddown.stop(args[0]!);
  if (action === "decline" && args.length === 1 && options.revision && /^\d+$/.test(options.revision) && options["confirm-review"]) return sdk.winddown.decline(args[0]!, Number(options.revision), true);
  if ((action === "preview" || action === "commit") && args.length === 1 && options.session) {
    if (action === "commit" && (!options["confirm-git"] || !options.digest || !options.revision || !/^\d+$/.test(options.revision))) throw new Error("Actual-user Git publication requires --confirm-git, exact --digest and --revision after the accepted-byte/new-branch review.");
    const metadata = await stat(args[0]!);
    if (!metadata.isFile() || metadata.size > 32768) throw new Error("Select a regular checkpoint Git selection JSON file up to 32 KiB.");
    const bytes = await readFile(args[0]!); if (bytes.byteLength > 32768) throw new Error("Checkpoint Git selection grew beyond its exact 32-KiB limit; nothing was truncated.");
    const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (!isRecord(value) || Object.hasOwn(value, "sessionId")) throw new Error("--session binds the exact original actual source. Do not include session/root/profile/actor overrides.");
    if (action === "preview") return sdk.query(parse(WinddownQuerySchema, { ...value, type: "winddown.commit.preview", sessionId: options.session }));
    const command = parse(WinddownCommandSchema, { ...value, type: "winddown.commit", sessionId: options.session, expectedRevision: Number(options.revision), expectedDigest: options.digest, confirm: true });
    if (command.type !== "winddown.commit") throw new Error("The exact Git command changed its requested type. No fallback.");
    const created = await sdk.command(command); if (!created.id) throw new Error("No original checkpoint/Git identity was acknowledged. Inspect before another review.");
    const stop = () => { void sdk.winddown.stop(created.id!).catch((error: unknown) => console.error(error instanceof Error ? error.message : "Checkpoint stop could not be acknowledged; inspect its original ref/intent.")); };
    process.once("SIGINT", stop);
    try { return await sdk.winddown.waitCommit(created.id); }
    finally { process.removeListener("SIGINT", stop); }
  }
  throw new Error("Use winddown status --session ID, list/read/stop/inspect ID, source-preview ID PATH..., source-accept ID PATH... --revision N --digest SHA --confirm-review, reconcile ID --revision N --digest SHA --confirm-review, decline ID --revision N --confirm-review, preview INPUT.json --session ID or commit INPUT.json --session ID --revision N --digest SHA --confirm-git.");
}
