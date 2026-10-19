import { parseArgs } from "node:util";
import { readFile, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { connectMoguri, stopMoguriService, ensureConnection, stateDirectory, sdkServicePath } from "../../../packages/sdk/src/node.ts";
import { serveGatewayMcp } from "../../../packages/sdk/src/mcp-server.ts";
import { defaultSettings, parse, DraftEditor, SettingsSchema, ProjectSettingsSchema, SessionChangesSchema, ModelOptionsSchema, ConfigurationSpecSchema, ControlDefaultsSchema, isRecord, SYSTEM_PROMPT_WARNING, IssueInputSchema, BoardConfigSchema, type ControlDefaults } from "../../../packages/sdk/src/index.ts";

export async function main(argv: string[]): Promise<void> {
  const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, options: {
    help: { type: "boolean" }, session: { type: "string" }, project: { type: "string" }, workspace: { type: "string" },
    "acknowledge-prompt-risk": { type: "boolean" }, "accept-license": { type: "boolean" }, json: { type: "boolean" },
    "accept-dependency-metadata": { type: "boolean" }, "run-scripts": { type: "boolean" }, revision: { type: "string" },
    "confirm-remove": { type: "boolean" }, "confirm-push": { type: "boolean" }, "confirm-review": { type: "boolean" }, digest: { type: "string" },
    "all-projects": { type: "boolean" }, "acknowledge-config-risk": { type: "boolean" },
    controls: { type: "string" }, stdio: { type: "boolean" },
  } });
  const [group = "tui", action, ...args] = positionals;
  if (values.help || group === "help") {
    console.log(`Moguri CLI + SDK

moguri [tui] [--project PATH]       Terminal client
moguri desktop                    Desktop client, same SDK
moguri status                     Project/session IDs and current work state
moguri session create [--project ID]  Omit project for a project-free chat
moguri session create --controls FILE  Explicit startup control overrides
moguri models list|refresh         Copilot and configured local model discovery
moguri models token ENDPOINT       Piped stdin only, never a shell argument
moguri models clear-token ENDPOINT Remove the resource-bound endpoint key
moguri remote status|probe          Pinned SSH worker/runtime readiness
moguri remote reconcile RUN_ID      Existing receipts/late usage, never replay
moguri remote acknowledge RUN_ID --confirm-review  After actual process inspection
moguri remote token|clear-token ENDPOINT  Piped remote endpoint credential
moguri worker --stdio              Installed versioned SSH worker bridge
moguri workspace list PROJECT_ID
moguri workspace discover PROJECT_ID  Read registrations, never adopt roots
moguri workspace create PROJECT_ID BRANCH [BASE_REF]
moguri workspace inspect|reconcile ID [--revision N]
moguri workspace remove ID --revision N --confirm-remove
moguri workspace session ID        New chat in an explicit owned worktree
moguri workspace files|file PATH --session ID
moguri metachat [REQUEST] [--session ID|--project ID]
moguri suggestions preview|generate --session ID [--all-projects] [--digest SHA256]
moguri configuration propose FILE --session ID
moguri configuration review|apply|reject ID --digest SHA256 [--acknowledge-config-risk]
moguri attention list|read ID
moguri context file|image PATH --session ID
moguri context folder PATH|github URL|session SOURCE_ID --session ID [--digest SHA256 --confirm-review]
moguri context read ATTACHMENT_ID --session ID
moguri slash "/read-only" --session ID
moguri session rename NAME|mode agent|mode read-only --session ID
moguri session spawn side|agent [NAME] --session ID
moguri session organize changes.json --session ID --revision N
moguri session model-settings options.json --session ID --revision N
moguri session context --session ID
moguri session archive|restore|stop|resume --session ID
moguri session delete --session ID --revision N --confirm-remove
moguri session from-pr URL|from-issue ID --project ID
moguri project get|sources|diff|porto ID
moguri project set ID settings.json --revision N
moguri project relocate ID PATH --revision N
moguri project remove ID --revision N --confirm-remove
moguri project defaults ID BRANCH --revision N --confirm-push
moguri project import-mcp ID --revision N --confirm-review --digest SHA256
moguri queue list|copy [ID]|run ID|remove ID --session ID
moguri queue hold FILE|edit ID FILE|reorder ID ID ... --session ID
moguri plan read|capture|save FILE --session ID [--digest SHA256_OR_absent]
moguri service restart|stop|info   Explicit owned-service lifecycle
moguri config get|set FILE|reset   Shared, restorable settings
moguri prompt get|set FILE|reset   Editable system prompt (risk acknowledgement required)
moguri memory index PROJECT_ID|search PROJECT_ID TEXT|graph PROJECT_ID
moguri skills import PROJECT_ID SKILL.md
moguri plugins import PROJECT_ID manifest.json
moguri mcp --session SESSION_ID    Native stdio MCP gateway
moguri mcp tools SERVER [QUERY]    Bounded tool discovery
moguri mcp auth SERVER             Credential status (never token values)
moguri mcp login SERVER [--session ID]  Explicit OAuth; prints the authorization URL
moguri mcp oauth-status|cancel AUTH_ID
moguri mcp clear-oauth SERVER [--session ID]
moguri mcp oauth-client SERVER     Read registered client JSON from piped stdin
moguri mcp token SERVER            Read a bearer credential from piped stdin
moguri dictate download --accept-license
moguri dictate record|file WAV --session SESSION_ID
moguri agents run TEXT --session SESSION_ID
moguri issues list|refresh PROJECT_ID
moguri issues create PROJECT_ID issue.json
moguri issues update ISSUE_ID issue.json --revision N
moguri issues move ISSUE_ID PHASE --revision N
moguri issues archive|restore ISSUE_ID --revision N
moguri issues configure PROJECT_ID board.json --revision N
moguri cache inspect PROJECT_ID npm|pnpm
moguri cache prepare|install PROJECT_ID MANAGER SHA256 --accept-dependency-metadata
moguri linear status|import PROJECT_ID [CURSOR]
moguri linear token|clear-token    Read a personal API key from piped stdin

SDK: import { MoguriSdk } from "moguri"; import { connectMoguri, createRuntime } from "moguri/node".
Dictation uses a user-downloaded local NVIDIA model, never hosted ASR.
`);
    return;
  }
  if (group === "worker") {
    await import(new URL(import.meta.url.endsWith(".ts") ? "../../service/src/remote-bridge.ts" : "./remote-bridge.mjs", import.meta.url).href);
    return;
  }
  if (group === "tui" || group === "desktop") {
    const require = createRequire(import.meta.url);
    const root = fileURLToPath(new URL(".", import.meta.url));
    const runtime = group === "desktop" ? require("electron") as string : process.execPath;
    const args = group === "desktop" ? [fileURLToPath(new URL("..", import.meta.url))] : [`${root}tui.mjs`, ...(values.project ? ["--project", values.project] : [])];
    const child = spawn(runtime, args, { stdio: "inherit" });
    await new Promise<void>((resolve, reject) => { child.on("error", reject); child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`Moguri ${group} exited with ${code}.`))); });
    return;
  }
  if (group === "service") {
    if (!action || !["stop", "restart", "info"].includes(action)) throw new Error("Use service info, service stop or service restart.");
    if (action === "stop" || action === "restart") await stopMoguriService();
    if (action !== "stop") {
      const connection = await ensureConnection({ servicePath: sdkServicePath() });
      console.log(JSON.stringify({ pid: connection.pid, protocolVersion: connection.protocolVersion, stateDir: stateDirectory() }));
    }
    return;
  }
  const sdk = await connectMoguri();
  let keep = false;
  const output = (value: unknown) => console.log(typeof value === "string" ? value : JSON.stringify(value, null, 2));
  const waitForJob = async (jobId: string, stop: () => Promise<unknown>, label = "Dictation") => {
    const cancel = () => { void stop().catch((error: unknown) => console.error(`${label} stop was not confirmed: ${error instanceof Error ? error.message : "inspect the active job"}`)); };
    process.once("SIGINT", cancel);
    try {
      const job = await sdk.jobs.wait(jobId); output(job);
      if (job.status !== "completed") throw new Error(job.error ?? `${label} ${job.status}; no success was recorded.`);
      output(await sdk.mcp.readResult(jobId));
    } finally { process.off("SIGINT", cancel); }
  };
  const expectedRevision = () => {
    if (!values.revision || !/^\d+$/.test(values.revision) || !Number.isSafeInteger(Number(values.revision))) throw new Error("Pass the observed --revision N. Stale local edits are never silently overwritten.");
    return Number(values.revision);
  };
  const credential = async (limit = 32768) => {
    if (process.stdin.isTTY) throw new Error("Pipe the credential through stdin, not command arguments or shell history.");
    let value = ""; for await (const chunk of process.stdin) { value += String(chunk); if (value.length > limit) throw new Error("Credential is too large."); }
    return value.trim();
  };
  try {
    const snapshot = sdk.getState().snapshot!;
    const projectId = args[0] ?? values.project;
    if (group === "status") {
      output({ protocolVersion: snapshot.protocolVersion, profileId: snapshot.profileId, projects: snapshot.projects, sessions: snapshot.sessions.map(({ id, projectId, title, status, mode, parentSessionId }) => ({ id, projectId, title, status, mode, parentSessionId })) });
    } else if (group === "context") {
      if (!values.session || !args[0]) throw new Error("Choose --session ID and an explicit source path/reference.");
      if (action === "file" || action === "image") output(await sdk.attachments.file(values.session, args[0], action === "image" ? "image" : "text"));
      else if (action === "read") { const result = await sdk.attachments.read(values.session, args[0]); output(result.content.kind === "text" ? result.content.text : { attachment: result.attachment, diagnostic: "Use SDK/desktop for private image bytes; no clipboard capability is assumed." }); }
      else if (action === "folder" || action === "github" || action === "session") {
        if (values.digest && values["confirm-review"]) output(action === "folder" ? await sdk.attachments.folder(values.session, args[0], values.digest, true) : action === "github" ? await sdk.attachments.github(values.session, args[0], "public", values.digest, true) : await sdk.attachments.session(values.session, args[0], values.digest, true));
        else if (values.digest || values["confirm-review"]) throw new Error("Use both --digest SHA256 and --confirm-review after inspecting the source snapshot.");
        else output(action === "folder" ? await sdk.attachments.folderPreview(values.session, args[0]) : action === "github" ? await sdk.attachments.githubPreview(values.session, args[0]) : await sdk.attachments.sessionPreview(values.session, args[0]));
      } else throw new Error("Use context file/image/folder/github/session/read. No source is attached implicitly.");
    } else if (group === "workspace") {
      if (action === "list" && args[0]) output(snapshot.managedWorkspaces.filter((workspace) => workspace.projectId === args[0]));
      else if (action === "discover" && args[0]) output(await sdk.workspaces.discover(args[0]));
      else if (action === "create" && args[0] && args[1]) { const created = await sdk.workspaces.create(args[0], args[1], args[2] ? { baseRef: args[2] } : {}); output(await sdk.workspaces.wait(created.id!)); }
      else if (action === "inspect" && args[0]) output(await sdk.workspaces.inspect(args[0]));
      else if (action === "reconcile" && args[0]) output(await sdk.workspaces.reconcile(args[0], expectedRevision()));
      else if (action === "remove" && args[0] && values["confirm-remove"]) { await sdk.workspaces.remove(args[0], expectedRevision(), true); output(await sdk.workspaces.wait(args[0])); }
      else if (action === "session" && args[0]) { const workspace = snapshot.managedWorkspaces.find((workspace) => workspace.id === args[0]); if (!workspace) throw new Error("Choose an owned workspace ID."); output(await sdk.sessions.create(workspace.projectId, workspace.branch, { env: "Local" }, workspace.id)); }
      else if (action === "files" && values.session) output(await sdk.workspaces.files(values.session, args[0] ?? "."));
      else if (action === "file" && values.session && args[0]) output(await sdk.workspaces.file(values.session, args[0]));
      else throw new Error("Use workspace list/discover/create/inspect/reconcile/remove/session/files/file. File reads need PATH and --session ID; removal needs the observed revision and --confirm-remove. Branches are preserved.");
    } else if (group === "remote") {
      if (action === "status") output(await sdk.remote.status());
      else if (action === "probe") { await sdk.remote.probe(); output(await sdk.remote.status()); }
      else if (action === "reconcile" && args[0]) { await sdk.remote.reconcile(args[0]); output(sdk.getState().snapshot!.executions.find((execution) => execution.id === args[0])); }
      else if (action === "acknowledge" && args[0] && values["confirm-review"]) output(await sdk.remote.acknowledge(args[0], true));
      else if (action === "token" && args[0]) output(await sdk.remote.setToken(args[0], await credential()));
      else if (action === "clear-token" && args[0]) output(await sdk.remote.clearToken(args[0]));
      else throw new Error("Use remote status/probe/reconcile RUN_ID, acknowledge RUN_ID --confirm-review only after process inspection, or token/clear-token ENDPOINT.");
    } else if (group === "models") {
      if (action === "list") output({ models: snapshot.provider.models, connections: snapshot.provider.connections });
      else if (action === "refresh") { await sdk.models.refresh(); output(sdk.getState().snapshot!.provider); }
      else if (action === "token" && args[0]) output(await sdk.models.setToken(args[0], await credential()));
      else if (action === "clear-token" && args[0]) output(await sdk.models.clearToken(args[0]));
      else throw new Error("Use models list, refresh, token ENDPOINT or clear-token ENDPOINT. Configure explicit endpoint URLs/limits in shared settings.");
    } else if (group === "slash") {
      if (!values.session || !action) throw new Error("Use slash '/COMMAND ARGUMENT' --session ID. Native panels are returned as typed actions, not opened by this CLI.");
      output(await sdk.slash(values.session, [action, ...args].join(" "), "cli"));
    } else if (group === "metachat") {
      if (values.session && values.project) throw new Error("Choose --session or --project, not both. A settings chat cannot silently change its parent's scope.");
      const parent = snapshot.sessions.find((session) => session.id === values.session);
      if (values.session && !parent) throw new Error("Choose an existing parent session.");
      output(await sdk.metachat.create(parent ? parent.projectId : values.project ?? null, parent?.id, [action, ...args].filter(Boolean).join(" ") || undefined));
    } else if (group === "suggestions") {
      if (!values.session) throw new Error("Choose --session ID and preview the exact source scope first.");
      if (action === "preview") output(await sdk.suggestions.preview(values.session, values["all-projects"] ?? false));
      else if (action === "generate" && values.digest) output(await sdk.suggestions.generate(values.session, values.digest, values["all-projects"] ?? false, true));
      else throw new Error("Use suggestions preview, then generate with its reviewed --digest. Cross-project scope requires --all-projects.");
    } else if (group === "configuration") {
      if (action === "propose" && args[0] && values.session) {
        const file = await stat(args[0]); if (!file.isFile() || file.size > 128 * 1024) throw new Error("Choose a regular configuration proposal JSON file up to 128 KiB.");
        output(await sdk.configuration.propose(values.session, parse(ConfigurationSpecSchema, JSON.parse(await readFile(args[0], "utf8")))));
      }
      else if (action === "review" && args[0]) output(await sdk.configuration.review(args[0]));
      else if ((action === "apply" || action === "reject") && args[0] && values.digest) output(await sdk.configuration.decide(args[0], action === "apply", values.digest, values["acknowledge-config-risk"] ?? false));
      else throw new Error("Review scope/base/value first; apply needs --digest and --acknowledge-config-risk. Propose reads a bounded JSON file with --session ID.");
    } else if (group === "attention") {
      if (action === "list") output(snapshot.attention.filter((entry) => entry.active));
      else if (action === "read" && args[0]) output(await sdk.attention.acknowledge([args[0]]));
      else throw new Error("Use attention list or read ATTENTION_ID. Reading never approves or answers.");
    } else if (group === "session") {
      if (action === "create") {
        let overrides: ControlDefaults | undefined;
        if (values.controls) { const file = await stat(values.controls); if (!file.isFile() || file.size > 128 * 1024) throw new Error("Choose a bounded control-overrides JSON file."); overrides = parse(ControlDefaultsSchema, JSON.parse(await readFile(values.controls, "utf8"))); }
        output(await sdk.sessions.create(values.project ?? null, undefined, overrides, values.workspace));
      }
      else if ((action === "from-pr" || action === "from-issue") && values.project && args[0]) output(await sdk.sessions.fromWork(values.project, action === "from-pr" ? { prUrl: args[0] } : { issueId: args[0] }, values.workspace));
      else {
        if (!values.session) throw new Error("Choose --session ID from moguri status.");
        if (action === "rename") output(await sdk.sessions.rename(values.session, args.join(" ")));
        else if (action === "mode" && (args[0] === "agent" || args[0] === "read-only")) output(await sdk.sessions.mode(values.session, args[0]));
        else if (action === "spawn" && (args[0] === "agent" || args[0] === "side")) output(await sdk.sessions.spawn(values.session, args[0], args.slice(1).join(" ") || undefined));
        else if (action === "organize" && args[0]) output(await sdk.sessions.organize(values.session, parse(SessionChangesSchema, JSON.parse(await readFile(args[0], "utf8"))), expectedRevision()));
        else if (action === "model-settings" && args[0]) output(await sdk.sessions.modelOptions(values.session, parse(ModelOptionsSchema, JSON.parse(await readFile(args[0], "utf8"))), expectedRevision()));
        else if (action === "context") output(await sdk.sessions.context(values.session));
        else if (action === "delete" && values["confirm-remove"]) output(await sdk.sessions.delete(values.session, true, expectedRevision()));
        else if (action && ["archive", "restore", "stop", "resume"].includes(action)) output(await sdk.command({ type: `session.${action}` as "session.archive" | "session.restore" | "session.stop" | "session.resume", sessionId: values.session }));
        else throw new Error("Use session rename/mode/spawn/organize/archive/restore/stop/resume/delete. Deletion needs --confirm-remove and the observed --revision.");
      }
    } else if (group === "project") {
      if (!args[0]) throw new Error("Choose the project ID from moguri status.");
      if (action === "get") output(await sdk.projects.configuration(args[0]));
      else if (action === "sources") output(await sdk.projects.sources(args[0]));
      else if (action === "diff") output(await sdk.projects.git(args[0]));
      else if (action === "porto") output(await sdk.projects.porto(args[0]));
      else if (action === "set" && args[1]) output(await sdk.projects.configure(args[0], parse(ProjectSettingsSchema, JSON.parse(await readFile(args[1], "utf8"))), expectedRevision()));
      else if (action === "relocate" && args[1]) output(await sdk.projects.relocate(args[0], args[1], expectedRevision()));
      else if (action === "remove" && values["confirm-remove"]) output(await sdk.projects.remove(args[0], true, expectedRevision()));
      else if (action === "import-mcp" && values["confirm-review"] && values.digest) output(await sdk.projects.importMcp(args[0], expectedRevision(), true, values.digest));
      else if (action === "defaults" && args[1] && values["confirm-push"]) {
        const job = await sdk.projects.initialize(args[0], args[1], expectedRevision(), true);
        await waitForJob(job.id!, () => sdk.jobs.cancel(job.id!), "Repository defaults");
      } else throw new Error("Use project get/sources/diff/porto/set/relocate/remove/defaults/import-mcp. Mutations need an observed --revision and any explicit confirmation shown in --help.");
    } else if (group === "queue" || group === "plan") {
      const session = snapshot.sessions.find((session) => session.id === values.session);
      if (!session) throw new Error("Choose an existing --session ID.");
      if (group === "plan") {
        if (action === "read") output(await sdk.plans.read(session.id));
        else if (action === "capture") output(await sdk.plans.capture(session.id, args[0]));
        else if (action === "save" && args[0] && values.digest) output(await sdk.plans.save(session.id, await readFile(args[0], "utf8"), values.digest));
        else throw new Error("Use plan read/capture, or plan save FILE --digest OBSERVED_SHA256_OR_absent.");
      } else if (action === "list") output(session.queue);
      else if (action === "copy") output(sdk.prompts.text(session.id, args[0]));
      else if (action === "run" && args[0]) output(await sdk.prompts.release(session.id, args[0], expectedRevision()));
      else if (action === "remove" && args[0]) output(await sdk.command({ type: "queue.remove", sessionId: session.id, messageId: args[0], expectedRevision: expectedRevision() }));
      else if (action === "edit" && args[0] && args[1]) output(await sdk.command({ type: "queue.edit", sessionId: session.id, messageId: args[0], text: await readFile(args[1], "utf8"), expectedRevision: expectedRevision() }));
      else if (action === "reorder") output(await sdk.command({ type: "queue.reorder", sessionId: session.id, messageIds: args, expectedRevision: expectedRevision() }));
      else if (action === "hold" && args[0]) {
        if (session.draft.text || session.draft.attachments.length) throw new Error("Save or use the existing draft first. CLI queue hold never replaces unsent edits.");
        const draft = new DraftEditor(sdk, session.id, session.draft);
        try { draft.edit(await readFile(args[0], "utf8")); output(await draft.send("queue", true)); } finally { draft.dispose(); }
      } else throw new Error("Use queue list/copy/run/remove/edit/reorder/hold. Queue mutations use the observed queue --revision.");
    } else if (group === "issues") {
      if (!args[0]) throw new Error("Choose a project or issue ID from moguri status or issues list.");
      if (action === "list") output(await sdk.issues.board(args[0]));
      else if (action === "refresh") output(await sdk.issues.refresh(args[0]));
      else if ((action === "create" || action === "update") && args[1]) {
        const fields = parse(IssueInputSchema, JSON.parse(await readFile(args[1], "utf8")));
        output(action === "create" ? await sdk.issues.create(args[0], fields) : await sdk.issues.update(args[0], fields, expectedRevision()));
      } else if (action === "configure" && args[1]) output(await sdk.issues.configure(args[0], parse(BoardConfigSchema, JSON.parse(await readFile(args[1], "utf8"))), expectedRevision()));
      else if (action === "move" && args[1]) output(await sdk.issues.move(args[0], args[1], expectedRevision()));
      else if (action === "archive" || action === "restore") output(await sdk.issues.archive(args[0], action === "archive", expectedRevision()));
      else throw new Error("Use issues list/create/update/move/archive/restore/configure/refresh; inspect --help for arguments.");
    } else if (group === "cache") {
      const manager = args[1];
      if (!args[0] || manager !== "npm" && manager !== "pnpm") throw new Error("Choose cache inspect PROJECT_ID npm|pnpm first.");
      if (action === "inspect") output(await sdk.cache.inspect(args[0], manager, values.workspace));
      else {
        if (!args[2] || !values["accept-dependency-metadata"]) throw new Error("Review the exact plan, then pass its SHA-256 and --accept-dependency-metadata to authorize OSV name/version disclosure. Scripts stay blocked.");
        const job = action === "prepare" ? await sdk.cache.prepare(args[0], manager, args[2], true, values.workspace) :
          action === "install" ? await sdk.cache.install(args[0], manager, args[2], true, values["run-scripts"] ?? false, values.workspace) : null;
        if (!job?.id) throw new Error("Use cache prepare or cache install. Install explicitly replaces this project's node_modules.");
        const id = job.id;
        await waitForJob(id, () => sdk.jobs.cancel(id), "Dependency cache");
      }
    } else if (group === "linear") {
      if (action === "token") output(await sdk.linear.setToken(await credential(4096)));
      else if (action === "clear-token") output(await sdk.linear.clearToken());
      else if (action === "status" && args[0]) output(await sdk.linear.status(args[0]));
      else if (action === "import" && args[0]) {
        const job = await sdk.linear.import(args[0], args[1]);
        await waitForJob(job.id!, () => sdk.jobs.cancel(job.id!), "Linear import");
      } else throw new Error("Use linear token, clear-token, status PROJECT_ID or import PROJECT_ID [CURSOR]. Optional Linear must be enabled on the board first.");
    } else if (group === "config") {
      if (action === "get") output(snapshot.settings);
      else if (action === "reset") output(await sdk.settings.reset("all", snapshot.settings.revision));
      else if (action === "set" && args[0]) output(await sdk.settings.update(parse(SettingsSchema, JSON.parse(await readFile(args[0], "utf8"))), snapshot.settings.revision, values["acknowledge-prompt-risk"] ?? false));
      else throw new Error("Use config get, config set FILE or config reset.");
    } else if (group === "prompt") {
      if (action === "get") output(await sdk.prompt.preview(values.session));
      else if (action === "reset") output(await sdk.prompt.reset(snapshot.settings.revision));
      else if (action === "set" && args[0]) {
        if (!values["acknowledge-prompt-risk"]) throw new Error(SYSTEM_PROMPT_WARNING + " Pass --acknowledge-prompt-risk only after reviewing it.");
        output(await sdk.prompt.set(await readFile(args[0], "utf8"), snapshot.settings.revision, true));
      } else throw new Error("Use prompt get, prompt set FILE or prompt reset.");
    } else if (group === "memory") {
      if (!projectId) throw new Error("Pass a project ID from the shared SDK snapshot.");
      if (action === "index") output(await sdk.memory.index(projectId, values.workspace));
      else if (action === "search") output(await sdk.memory.search(projectId, args.slice(1).join(" "), 6, values.workspace));
      else if (action === "graph") output(await sdk.memory.graph(projectId, args[1] ?? "", values.workspace));
      else throw new Error("Use memory index, search or graph.");
    } else if (group === "skills" || group === "plugins") {
      if (action !== "import" || !args[0] || !args[1]) throw new Error("Use import PROJECT_ID FILE. Imported capabilities start disabled.");
      output(group === "skills" ? await sdk.capabilities.importSkill(args[0], args[1]) : await sdk.capabilities.importPlugin(args[0], args[1]));
    } else if (group === "mcp") {
      if (!action) {
        if (!values.session) throw new Error("Bind the gateway to --session SESSION_ID. It cannot approve itself.");
        await serveGatewayMcp(sdk, values.session); keep = true;
      } else if (action === "tools") output(await sdk.mcp.tools(args[0] ?? "builtin", args.slice(1).join(" "), 0, values.session));
      else if (action === "auth" && args[0]) output(await sdk.mcp.auth(args[0], values.session));
      else if (action === "login" && args[0]) { const result = await sdk.mcp.oauthBegin(args[0], values.session); output(await sdk.mcp.oauthStatus(result.id!)); }
      else if (action === "oauth-status" && args[0]) output(await sdk.mcp.oauthStatus(args[0]));
      else if (action === "cancel" && args[0]) output(await sdk.mcp.oauthCancel(args[0]));
      else if (action === "clear-oauth" && args[0]) output(await sdk.mcp.oauthClear(args[0], values.session));
      else if (action === "oauth-client" && args[0]) {
        const input: unknown = JSON.parse(await credential());
        if (!isRecord(input) || typeof input.clientId !== "string" || typeof input.issuer !== "string" || input.clientSecret !== undefined && typeof input.clientSecret !== "string" || input.redirectUri !== undefined && typeof input.redirectUri !== "string") throw new Error("Pipe a registered-client object with clientId, issuer, optional clientSecret and optional fixed loopback redirectUri.");
        output(await sdk.mcp.oauthClient(args[0], input.clientId, input.issuer, typeof input.clientSecret === "string" ? input.clientSecret : undefined, values.session, typeof input.redirectUri === "string" ? input.redirectUri : undefined));
      }
      else if (action === "token" && args[0]) {
        output(await sdk.mcp.setToken(args[0], await credential(), values.session));
      } else throw new Error("Use mcp --session ID, mcp tools, mcp auth or mcp token.");
    } else if (group === "dictate") {
      if (action === "download") {
        if (!values["accept-license"]) throw new Error("Review OpenMDW-1.1 and the 708 MiB model download, then pass --accept-license.");
        const job = await sdk.voice.download(true);
        await waitForJob(job.id!, () => sdk.jobs.cancel(job.id!));
      }
      else if (action === "status") output(await sdk.voice.status());
      else {
        if (!values.session) throw new Error("Choose --session SESSION_ID. Transcription never sends the prompt.");
        const job = action === "record" ? await sdk.voice.record(values.session) : action === "file" && args[0] ? await sdk.voice.transcribe(values.session, args[0]) : null;
        if (!job?.id) throw new Error("Use dictate record or dictate file recording.wav.");
        const id = job.id;
        await waitForJob(id, () => action === "record" ? sdk.voice.stop(id) : sdk.jobs.cancel(id));
      }
    } else if (group === "agents" && action === "run") {
      if (!values.session) throw new Error("Choose --session SESSION_ID and explicitly enable optional subagents first.");
      output(await sdk.subagents.run(values.session, args.join(" ")));
    } else throw new Error("Unknown command. Run moguri --help.");
  } finally { if (!keep) sdk.disconnect(); }
}
if (import.meta.main) {
  try { await main(process.argv.slice(2)); }
  catch (error) { console.error(error instanceof Error ? error.message : "Moguri command failed."); process.exitCode = 1; }
}
export { defaultSettings };
