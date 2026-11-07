import { readFile, stat } from "node:fs/promises";
import {
  ClientError, GithubActionSchema, GithubBrowseSchema, GithubCommandSchema, LinearCatalogResourceSchema, LinearWorkflowInputSchema,
  isRecord, parse, type GithubScope, type MoguriSdk,
} from "../../../packages/sdk/src/index.ts";
import { gitSessionScope } from "../../../packages/sdk/src/git.ts";

interface Flags { project?: string; workspace?: string; session?: string; digest?: string; confirmations?: string; revision?: string; "confirm-review"?: boolean }
async function json(path: string | undefined): Promise<unknown> {
  if (!path) throw new ClientError("integration_file", "Choose an exact reviewed JSON input file.");
  const metadata = await stat(path);
  if (!metadata.isFile() || metadata.size > 512 * 1024) throw new ClientError("integration_file", "Choose a regular input file up to 512 KiB.");
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await readFile(path)));
}
export async function integrationCommand(sdk: MoguriSdk, group: "github" | "linear", action: string | undefined, args: string[], flags: Flags): Promise<unknown> {
  const confirm = () => {
    if (!flags["confirm-review"] || !flags.digest) throw new ClientError("integration_review", "Inspect the exact preview, then pass its --digest SHA and --confirm-review. No current review was silently substituted.");
    return true as const;
  };
  if (group === "github") {
    if (action === "ci" || action === "ci-preview") {
      if (!flags.session || args.length > 1 || args[0] && (!/^[1-9]\d*$/.test(args[0]) || !Number.isSafeInteger(Number(args[0])))) {
        throw new ClientError("github_ci_selection", "Use github ci|ci-preview [PR_NUMBER] --session ID. Omit the number only for a unique linked PR.");
      }
      const scope = gitSessionScope(sdk, flags.session);
      if (flags.project && flags.project !== scope.projectId || flags.workspace && flags.workspace !== scope.workspaceId) {
        throw new ClientError("github_ci_scope", "Explicit project/workspace flags do not match the selected session. No other root was used.");
      }
      return action === "ci" ? sdk.github.ciForSession(flags.session, args[0] ? Number(args[0]) : undefined) :
        sdk.github.previewCiForSession(flags.session, args[0] ? Number(args[0]) : undefined);
    }
    if (!action || action === "history") return sdk.github.history({ ...(flags.project ? { projectId: flags.project } : {}) });
    if (action === "read" && args[0]) return sdk.github.read(args[0]);
    if (action === "wait" && args[0]) return sdk.github.wait(args[0], { timeoutMs: 30 * 60 * 1000 });
    if (action === "stop" && args[0]) return sdk.github.cancel(args[0]);
    if (action === "acknowledge" && args[0] && flags.revision && /^\d+$/.test(flags.revision) && flags.digest) {
      return sdk.github.acknowledge(args[0], Number(flags.revision), flags.digest, confirm());
    }
    if (!flags.project) throw new ClientError("github_scope", "Pass the exact Local --project ID and optional --workspace ID/--session ID. There is no checkout or account fallback.");
    const scope: GithubScope = { env: "Local", projectId: flags.project, ...(flags.workspace ? { workspaceId: flags.workspace } : {}), ...(flags.session ? { sessionId: flags.session } : {}) };
    if (action === "search" && args.length) {
      const project = await sdk.github.project(scope), result = await sdk.github.search(scope, project.repository, project.account, args.join(" "));
      if (result.accountId !== project.accountId) throw new ClientError("github_account", "The selected search account changed. No replacement result was adopted.");
      return result;
    }
    if (action === "preview") return sdk.github.preview(scope, parse(GithubActionSchema, await json(args[0])));
    if (action === "browse") {
      const value = await json(args[0]);
      if (!isRecord(value)) throw new ClientError("github_input", "Choose a complete bounded GitHub browse object.");
      return sdk.github.browse(scope, parse(GithubBrowseSchema, { ...value, page: value.page === undefined ? 1 : value.page, perPage: value.perPage === undefined ? 30 : value.perPage }));
    }
    if (action === "execute") {
      confirm();
      const confirmations = flags.confirmations ? await json(flags.confirmations) : [];
      return sdk.command(parse(GithubCommandSchema, { type: "github.execute", scope, action: parse(GithubActionSchema, await json(args[0])),
        expectedDigest: flags.digest, confirmations, confirm: true }));
    }
    throw new ClientError("github_command", "Use github search TERMS, browse REQUEST.json, preview ACTION.json, execute ACTION.json --digest SHA --confirm-review [--confirmations PHRASES.json], history, read/wait ID, or stop ID. Main/force-push, rebase, tags, releases and PR merge retain their own exact confirmations.");
  }
  if (action === "read" && args[0]) return sdk.linear.read(args[0]);
  if (action === "wait" && args[0]) return sdk.linear.wait(args[0]);
  if (action === "stop" && args[0]) return sdk.linear.cancel(args[0]);
  if (action === "history") return sdk.linear.history(flags.project);
  if (!flags.project) throw new ClientError("linear_scope", "Pass the exact --project ID with an explicitly enabled Linear team. No account or team was inferred.");
  if (action === "issue" && args[0]) return sdk.linear.issue(flags.project, args[0]);
  if (action === "catalog" && args[0]) return sdk.linear.catalog(flags.project, parse(LinearCatalogResourceSchema, args[0]),
    { ...(args[1] && args[1] !== "-" ? { cursor: args[1] } : {}), ...(args[2] ? { issueId: args[2] } : {}) });
  const scope = { projectId: flags.project, ...(flags.session ? { sessionId: flags.session } : {}) };
  if (action === "preview") return sdk.linear.preview(scope, parse(LinearWorkflowInputSchema, await json(args[0])));
  if (action === "execute") return sdk.linear.execute(scope, parse(LinearWorkflowInputSchema, await json(args[0])), flags.digest ?? "", confirm());
  throw new ClientError("linear_command", "Use linear catalog RESOURCE [CURSOR|-] [ISSUE_UUID] --project ID, issue UUID --project ID, preview INPUT.json --project ID, execute INPUT.json --project ID --digest SHA --confirm-review, history, read/wait ID, or stop ID.");
}
