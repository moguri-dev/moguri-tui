import { readFile, stat } from "node:fs/promises";
import {
  ClientError, HookDefinitionSchema, KnowledgeInputSchema, KnowledgePromotionSchema, MarketplaceInputSchema, MarketplaceSourceSchema,
  parse, type KnowledgeTier, type MoguriSdk, type WorkspaceFeature,
} from "@moguri-dev/sdk";

interface Flags { session?: string; project?: string; revision?: string; digest?: string; "confirm-review"?: boolean; "confirm-remove"?: boolean }
async function json(path: string | undefined): Promise<unknown> {
  if (!path) throw new ClientError("feature_file", "Choose the explicit reviewed JSON file.");
  const file = await stat(path);
  if (!file.isFile() || file.size > 256 * 1024) throw new ClientError("feature_file", "Choose a regular reviewed JSON file up to 256 KiB.");
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await readFile(path)));
}
export async function workspaceFeatureCommand(sdk: MoguriSdk, group: Exclude<WorkspaceFeature, "cache">, action: string | undefined, args: string[], flags: Flags): Promise<unknown> {
  const revision = () => {
    if (!flags.revision || !/^\d+$/.test(flags.revision) || !Number.isSafeInteger(Number(flags.revision))) throw new ClientError("feature_revision", "Pass the exact observed --revision N. No current revision was silently substituted.");
    return Number(flags.revision);
  };
  const confirm = () => {
    if (!flags["confirm-review"]) throw new ClientError("feature_review", "Inspect the exact retained bytes, scope and digest first, then pass --confirm-review.");
    return true as const;
  };
  if (group === "containment") {
    if (!action || action === "status") return sdk.containment.status();
    if (action === "require-sandbox") return sdk.containment.requireSandbox(confirm());
    throw new ClientError("containment_command", "Use containment status or require-sandbox --confirm-review. This changes global new-turn policy, never a running session's environment.");
  }
  if (group === "hooks") {
    if (action === "list" && flags.project) return sdk.getState().snapshot!.registry.filter((entry) => entry.projectId === flags.project && entry.kind === "hook");
    if (action === "import" && flags.project) {
      confirm(); return sdk.hooks.import(flags.project, parse(HookDefinitionSchema, await json(args[0])));
    }
    throw new ClientError("hook_command", "Use hooks list --project ID or import DEFINITION.json --project ID --confirm-review. Importing never enables or runs a hook.");
  }
  if (group === "marketplace") {
    if (action === "catalog") return sdk.marketplace.catalog(parse(MarketplaceSourceSchema, await json(args[0])));
    if (action === "preview") return sdk.marketplace.preview(parse(MarketplaceInputSchema, await json(args[0])));
    if (action === "install" && flags.digest) return sdk.marketplace.install(parse(MarketplaceInputSchema, await json(args[0])), flags.digest, confirm());
    throw new ClientError("marketplace_command", "Use marketplace catalog SOURCE.json, preview INPUT.json, or install INPUT.json --digest SHA --confirm-review. Roots and exact committed package/version stay explicit in JSON.");
  }
  if (group === "capability") {
    if (action === "history" && args[0]) return sdk.capabilities.history(args[0], args[1] ? Number(args[1]) : 0);
    if (action === "version" && args[0] && flags.digest) return sdk.capabilities.version(args[0], flags.digest);
    if (action === "use" && args[0] && flags.session && flags.digest) return sdk.capabilities.useSkill(flags.session, args[0], flags.digest);
    if ((action === "enable" || action === "disable") && args[0]) { confirm(); return sdk.capabilities.toggle(args[0], action === "enable", revision()); }
    if (action === "rollback" && args[0] && flags.digest) return sdk.capabilities.rollback(args[0], revision(), flags.digest, confirm());
    throw new ClientError("capability_command", "Use capability history ID [OFFSET], version ID --digest SHA, use ID --session ID --digest SHA, enable/disable ID --revision N --confirm-review, or rollback ID --revision N --digest SHA --confirm-review.");
  }
  if (action === "save") return sdk.knowledge.save(parse(KnowledgeInputSchema, await json(args[0])));
  if (action === "update" && args[0]) return sdk.knowledge.save(parse(KnowledgeInputSchema, await json(args[1])), args[0], revision());
  if (action === "promote" && args[0] && flags.digest) return sdk.knowledge.promote(args[0], revision(), flags.digest, parse(KnowledgePromotionSchema, await json(args[1])), confirm());
  if (action === "list" || action === "search") {
    const tier = args[0] ?? "Sky";
    if (!["Sky", "Terra", "Glacier"].includes(tier)) throw new ClientError("knowledge_tier", "Choose exactly Sky, Terra or Glacier.");
    return sdk.knowledge.list({ tier: tier as KnowledgeTier, ...(tier === "Sky" && flags.session ? { sessionId: flags.session } : tier === "Terra" && flags.project ? { projectId: flags.project } : {}),
      text: action === "search" ? args.slice(1).join(" ") : "" });
  }
  if (action === "read" && args[0]) return sdk.knowledge.read(args[0]);
  if (action === "history" && args[0]) return sdk.knowledge.history(args[0]);
  if (action === "version" && args[0] && flags.digest) return sdk.knowledge.version(args[0], flags.digest);
  if (action === "rollback" && args[0] && flags.digest) return sdk.knowledge.rollback(args[0], revision(), flags.digest, confirm());
  if (action === "forget" && args[0]) {
    if (!flags["confirm-remove"]) throw new ClientError("knowledge_forget", "Review this exact note and pass --confirm-remove to forget its retained revisions.");
    return sdk.knowledge.forget(args[0], revision(), true);
  }
  throw new ClientError("knowledge_command", "Use knowledge list/search TIER [TEXT] --session ID|--project ID, save INPUT.json, update ID INPUT.json --revision N, read/history/version ID, promote ID SUMMARY.json --revision N --digest SHA --confirm-review, rollback ID --revision N --digest SHA --confirm-review, or forget ID --revision N --confirm-remove.");
}
