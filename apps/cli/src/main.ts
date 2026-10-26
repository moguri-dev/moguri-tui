import { parseArgs } from "node:util";
import { readFile, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { connectMoguri, loadNotificationSoundFile, saveArtifactExport, stopMoguriService, ensureConnection, stateDirectory, sdkServicePath, waitForStorageRelocation } from "../../../packages/sdk/src/node.ts";
import { serveGatewayMcp } from "../../../packages/sdk/src/mcp-server.ts";
import { audioFromBase64, compareSessionOrder, defaultSettings, parse, DraftEditor, SettingsSchema, ProjectSettingsSchema, SessionChangesSchema, ModelOptionsSchema, ConfigurationSpecSchema, ControlDefaultsSchema, ProfileChangesSchema, ArtifactDraftSchema, ArtifactChangesSchema, ArtifactKindSchema, CandidatePatchSchema, CandidateGenerationInputSchema, ProjectArtifactChoiceSchema, isRecord, SYSTEM_PROMPT_WARNING, IssueInputSchema, BoardConfigSchema, type ControlDefaults } from "../../../packages/sdk/src/index.ts";
import { BUDGET_WARNING, BudgetLimitSchema, SessionBudgetSchema, ModelRoleSchema, BudgetQuerySchema, TelemetryQuerySchema } from "../../../packages/sdk/src/index.ts";
import { compoundCommand } from "./compound.ts";
import { winddownCommand } from "./winddown.ts";
import { decisionCommand } from "./decisions.ts";
import { workspaceFeatureCommand } from "./workspace-features.ts";
import { integrationCommand } from "./integrations.ts";
import { DependencyRegistryConfigSchema, PackageManagerSchema } from "../../../packages/sdk/src/index.ts";
import { DocumentReadOptionsSchema, DocumentSearchOptionsSchema, DocumentListOptionsSchema } from "../../../packages/sdk/src/index.ts";

export async function main(argv: string[]): Promise<void> {
  const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, options: {
    help: { type: "boolean" }, session: { type: "string" }, project: { type: "string" }, workspace: { type: "string" }, profile: { type: "string" }, color: { type: "string" },
    "acknowledge-prompt-risk": { type: "boolean" }, "accept-license": { type: "boolean" }, json: { type: "boolean" },
    "accept-dependency-metadata": { type: "boolean" }, "run-scripts": { type: "boolean" }, revision: { type: "string" },
    "confirm-remove": { type: "boolean" }, "confirm-push": { type: "boolean" }, "confirm-review": { type: "boolean" }, "forward-access": { type: "boolean" }, digest: { type: "string" }, binding: { type: "string" },
    "all-projects": { type: "boolean" }, "acknowledge-config-risk": { type: "boolean" },
    controls: { type: "string" }, stdio: { type: "boolean" }, foreground: { type: "boolean" },
    output: { type: "string" }, artifacts: { type: "string" }, "exported-digest": { type: "string" }, "source-type": { type: "string" },
    "confirm-write": { type: "boolean" }, "confirm-cost": { type: "boolean" }, generation: { type: "string" }, "role-sequence": { type: "string" }, branch: { type: "string" }, "materialization-id": { type: "string" },
    "confirm-stage-and-test": { type: "boolean" },
    "confirm-git": { type: "boolean" },
    confirmations: { type: "string" }, registry: { type: "string" },
    "capture-id": { type: "string" }, root: { type: "string" },
    model: { type: "string" }, provider: { type: "string" }, role: { type: "string" }, folder: { type: "string" }, filters: { type: "string" },
  } });
  const [group = "tui", action, ...args] = positionals;
  if (values.help || group === "help") {
    console.log(`Moguri CLI + SDK

moguri [tui] [--project PATH]       Terminal client
moguri desktop                    Desktop client, same SDK
moguri status                     Project/session IDs and current work state
moguri progress --session ID       Checked plan items and untrusted task estimate
moguri activity list --session ID  Retained chat operations, without new inference
moguri agent-terminal list --session ID  Approved Agent commands, never private consoles
moguri tools [OFFSET] [QUERY] --session ID  Scoped typed catalogue, no inference
moguri tool NAME SCHEMA_SHA ARGUMENTS_JSON --session ID  Exact approved Local job
moguri tool-result STEP CALL [OFFSET] --session ID  Original retained source
moguri state SELECT_SQL --session ID  Canonical todo/memory views
moguri watch read JOB [OFFSET] --session ID  Real logs, outcome and observed statistics
moguri coordinate read INPUT_JSON --session ID  Main/child context and progress
moguri coordinate message TARGET TEXT --session ID  Advisory only, no paid reply
moguri coordinate control INPUT_JSON --session ID  Explicit owned-child work
moguri coordinate preview CHILD --session ID  Actual roots and grant review
moguri COMMAND --profile ID        Immutable scope; never changes another client
moguri profile list|create NAME [--color '#RRGGBB']
moguri profile update ID CHANGES.json --revision N
moguri profile retry ID --revision N --confirm-review
moguri profile stop ID             Explicit owned setup cancellation
moguri profile defaults CONTROLS.json --revision N  Shared global preferences
moguri session create [--project ID]  Omit project for a project-free chat
moguri session create --controls FILE  Explicit startup control overrides
moguri models list|refresh         Copilot and configured local model discovery
moguri models evidence MODEL_ID   Explicit provider claims, not independence/quality; no inference
moguri models token ENDPOINT       Piped stdin only, never a shell argument
moguri models clear-token ENDPOINT Remove the resource-bound endpoint key
moguri remote status|probe          Pinned SSH worker/runtime readiness
moguri remote reconcile RUN_ID      Existing receipts/late usage, never replay
moguri remote acknowledge RUN_ID --confirm-review  After actual process inspection
moguri remote token|clear-token ENDPOINT  Piped remote endpoint credential
moguri sandbox status|runs         Read native readiness/original owners
moguri sandbox setup [VERSION]     Review bundled managed defaults and exact pins
moguri sandbox enable VERSION --digest SHA --revision N --confirm-review
moguri sandbox updates             Check public releases; never changes version
moguri sandbox prepare-version VERSION --confirm-review
moguri sandbox setup-operation|setup-cancel OPERATION_ID
moguri sandbox probe --confirm-review  Verify exact reviewed model-free native guest
moguri sandbox preview PATHS.json --session ID
moguri sandbox prepare PATHS.json --session ID --digest SHA --revision N --confirm-review
moguri sandbox execution|result|stop RUN_ID
moguri sandbox reconcile RUN_ID --confirm-review  Original signed guest only, no replay
moguri sandbox publish-preview RUN_ID PATHS.json
moguri sandbox publish RUN_ID PATHS.json --digest SHA --revision N --confirm-write
moguri sandbox publication|publication-stop|publication-wait PUBLICATION_ID
moguri worker --stdio              Installed versioned SSH worker bridge
moguri workspace list PROJECT_ID
moguri workspace discover PROJECT_ID  Read registrations, never adopt roots
moguri workspace create PROJECT_ID BRANCH [BASE_REF]
moguri workspace inspect|reconcile ID [--revision N]
moguri workspace remove ID --revision N --confirm-remove
moguri workspace session ID        New chat in an explicit owned worktree
moguri workspace files|file PATH --session ID
moguri candidate list|read ID
moguri candidate preview PATCH.json --session SOURCE --workspace STAGE [--role-sequence ID]
moguri candidate stage PATCH.json --session SOURCE --workspace STAGE --digest PREVIEW_SHA --confirm-write [--generation ID | --role-sequence ID]
moguri candidate role-proposal SEQUENCE_ID  Read final canonical role bytes; no model or write
moguri roles contract SEQUENCE_ID ROLE_INDEX  Read bound output/context checks, never code approval
moguri candidate eligibility --session ID  Verify the exact explicit Git-backed project
moguri candidate generate-preview INPUT.json --session SOURCE --workspace STAGE
moguri candidate generate INPUT.json --session SOURCE --workspace STAGE --digest REVIEW_SHA --confirm-cost
moguri candidate generated|generation-wait|generation-stop ID
moguri roles SEQUENCE_ID [ROLE_INDEX]   Read retained role data; never dispatch
moguri compound preview INPUT.json --session ID
moguri compound start INPUT.json --session ID --digest SHA --confirm-cost
moguri compound list|read|validation|stop ID  Inspect actual owned roles and exact pending reviews
moguri compound review ID VALIDATION --revision N --digest SHA --confirm-stage-and-test
moguri compound deny ID VALIDATION --revision N --digest SHA --confirm-review
moguri winddown status --session ID  Actual reserved-finishing readiness; no inference
moguri winddown list|read|stop ID  Retained capacity/model/Git observations
moguri winddown preview INPUT.json --session ID  Exact accepted-work/new-local-branch review
moguri winddown commit INPUT.json --session ID --revision N --digest SHA --confirm-git
moguri winddown decline ID --revision N --confirm-review  No Git/model effect
moguri decisions status --session ID  Actual compatible provider/bound readiness
moguri decisions list|read|stop ID   Retained actual actor, evidence and charges
moguri decisions set POLICY.json --confirm-review  Configure only; no inference or grant
moguri candidate apply-preview ID --session SOURCE
moguri candidate apply ID --session SOURCE --revision N --digest REVIEW_SHA --confirm-write
moguri candidate reject ID --revision N --confirm-review
moguri candidate stop|wait ID       Inspect actual partial/cancelled outcomes; never replay
moguri terminal list [--session ID]  Existing profile-owned consoles and actual Local/SSH roots
moguri terminal open --session ID   Explicit new user console, not an agent tool
moguri terminal open --session ID --root PATH  Explicit Local root for a project-free chat
moguri terminal default-root        Disclose the canonical home root; never starts a shell
moguri terminal read|reconcile|close ID
moguri terminal owner-reconcile OWNER_ID  Inspect even an owner with no terminal intent
moguri terminal owner-acknowledge OWNER_ID --confirm-review  No cleanup proof is inferred
moguri terminal input ID            Piped UTF-8 input only; no automatic replay
moguri terminal acknowledge ID --confirm-review  Only after actual process inspection
moguri artifact list|read ID|history ID
moguri artifact create DOCUMENT.json [--session ID|--project ID]
moguri artifact update ID CHANGES.json --revision N
moguri artifact source SOURCE_ID --session ID [--source-type message|tool]
moguri artifact promote SOURCE_ID KIND NAME --session ID --digest SHA256
moguri artifact archive|restore|delete ID --revision N [--confirm-remove]
moguri artifact export ID --output ABSOLUTE_NEW_JSON_PATH
moguri artifact materialization|stop-materialization JOB_ID
moguri question list|read ID
moguri question answer ID ANSWER_FILE --revision N
moguri question answer-other ID ANSWER_FILE --revision N
moguri question answer-draft ID --revision N
moguri budget status SESSION_ID
moguri budget dashboard|calls|plans [--project ID --folder ID --session ID --provider ID --model ID --role solver]
moguri budget dashboard --filters '{"range":{"kind":"days","days":30},"bucket":"week"}'
moguri telemetry operations [--project ID --session ID --filters JSON]
moguri telemetry storage           Current profile key-backed ciphertext, not disk usage
moguri repository preview|state --session ID
moguri repository refresh --session ID --digest BINDING --revision N --confirm-review
moguri repository clear --session ID --revision N --confirm-review
moguri repository stop JOB_ID --session ID
moguri budget set SESSION_ID BUDGET.json --confirm-review
moguri budget policy LIMIT_OR_NULL.json --revision N --confirm-review
moguri budget global LIMIT_OR_NULL.json --revision N --confirm-review
moguri project removal-preview ID
moguri project export-artifacts ID --output ABSOLUTE_NEW_JSON_PATH
moguri project materialize-preview ID [--workspace ID] [--branch NEW_LOCAL_BRANCH]
moguri project materialize-artifacts ID --digest REVIEW_SHA --confirm-write [--workspace ID] [--branch NEW_LOCAL_BRANCH]
moguri project remove ID --revision N --confirm-remove --artifacts retain|delete|export|materialize --digest SET_SHA [--exported-digest EXPORT_SHA|--materialization-id JOB_ID]
moguri metachat [REQUEST] [--session ID|--project ID]
moguri suggestions preview|generate --session ID [--all-projects] [--digest SHA256]
moguri configuration propose FILE --session ID
moguri configuration review|apply|reject ID --digest SHA256 [--acknowledge-config-risk]
moguri attention list|read ID
moguri context file|image|document PATH --session ID [--capture-id ID]
moguri context documents --session ID [--filters '{"offset":0,"limit":5}']
moguri context document-read ID --session ID [--filters '{"page":1,"limit":4096}']
moguri context document-search ID --session ID --filters '{"query":"literal"}'
moguri context original|cancel ID --session ID  Explicit original or owned capture
moguri context folder PATH|github URL|session SOURCE_ID --session ID [--digest SHA256 --confirm-review]
moguri context read ATTACHMENT_ID --session ID
moguri slash "/read-only" --session ID
moguri slash '/compact preview {"keepRecentTurns":1}' --session ID
moguri session rename NAME|mode agent|mode read-only --session ID
moguri session spawn side|agent [NAME] --session ID
moguri session organize changes.json --session ID --revision N
moguri session model-settings options.json --session ID --revision N
moguri session context --session ID
moguri session archive|restore|stop|resume --session ID
moguri session delete --session ID --revision N --confirm-remove
  Permanently deletes originating candidates/proposals too; ordinary artifacts and Git resources survive.
moguri session from-pr URL|from-issue ID --project ID
moguri project get|sources|diff|porto|repositories ID
moguri project add PATH              Register an existing local folder
moguri project clone URL PATH --confirm-write  Clone into a new folder; partial files are preserved
moguri project set ID settings.json --revision N
moguri project relocate ID PATH --revision N
moguri project remove ID --revision N --confirm-remove
moguri project defaults ID BRANCH --revision N --confirm-push
moguri project import-mcp ID --revision N --confirm-review --digest SHA256
moguri queue list|copy [ID]|run ID|remove ID --session ID
moguri queue hold FILE|edit ID FILE|reorder ID ID ... --session ID
moguri plan read|saves|info SAVE_ID|stop SAVE_ID --session ID
moguri plan save FILE --session ID --digest SHA256_OR_absent [--binding REMOTE_BINDING_SHA]
moguri service restart|stop|info   Explicit owned-service lifecycle
moguri runtime [status|power-retry]  Actual data directory and owned idle-sleep status
moguri storage status|preview PATH  Review all-profile store and retained resource roots
moguri storage move PATH --digest SHA --confirm-write  Quiesce, copy and retire; restart clients explicitly
moguri updates status|history|read ID|check|cancel ID
moguri updates token|clear-token     Separate private-release PAT through piped stdin only
moguri updates install-preview ID  Exact owned app/backup review; native install needs desktop confirmation
moguri notification-sounds list|read ID  Profile-owned audio metadata, no playback
moguri notification-sounds import FILE.wav --confirm-write  Explicit bounded snapshot
moguri notification-sounds remove ID --digest SHA --confirm-remove
moguri config get|set FILE|reset   Shared, restorable settings
moguri prompt get|set FILE|reset   Editable system prompt (risk acknowledgement required)
moguri memory index PROJECT_ID|search PROJECT_ID TEXT|graph PROJECT_ID
moguri memory index|state|search TEXT|graph [PATH] --session SESSION_ID
moguri knowledge list/search Sky|Terra|Glacier [TEXT] [--session ID|--project ID]
moguri knowledge save INPUT.json|update ID INPUT.json --revision N
moguri knowledge read|history ID|version ID --digest SHA
moguri knowledge promote ID SUMMARY.json --revision N --digest SHA --confirm-review
moguri knowledge rollback ID --revision N --digest SHA --confirm-review
moguri knowledge forget ID --revision N --confirm-remove
moguri marketplace catalog SOURCE.json|preview INPUT.json
moguri marketplace install INPUT.json --digest SHA --confirm-review  Installs disabled
moguri hooks list --project ID|import DEFINITION.json --project ID --confirm-review
moguri capability history ID [OFFSET]|version ID --digest SHA
moguri capability enable|disable ID --revision N --confirm-review
moguri capability rollback ID --revision N --digest SHA --confirm-review
moguri capability use ID --session ID --digest SHA  Inserts a skill into the saved draft
moguri containment status|require-sandbox --confirm-review  Explicit global new-turn policy
moguri skills import PROJECT_ID SKILL.md
moguri skills sources|find [QUERY] [--session ID]
moguri skills read ID --digest SHA [--session ID]  Refresh and check exact skill bytes
moguri dashboard [work|usage|cost|velocity] [--filters JSON --project ID]
moguri plugins import PROJECT_ID manifest.json
moguri mcp --session SESSION_ID    Native stdio MCP gateway
moguri mcp tools SERVER [QUERY]    Bounded tool discovery
moguri mcp auth SERVER             Credential status (never token values)
moguri mcp servers --session ID    Configured metadata, not tool authorization
moguri mcp remote-preview SERVER --session ID
moguri mcp remote-grant SERVER --session ID --digest SHA256 --revision N --confirm-review [--forward-access]
moguri mcp remote-revoke SERVER --session ID --revision N --confirm-review
moguri mcp remote-calls --session ID
moguri mcp remote-call OPERATION_ID --session ID
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
moguri cache inspect PROJECT_ID python|cargo|go
moguri cache prepare|install PROJECT_ID MANAGER SHA256 --accept-dependency-metadata
moguri cache registries|registry-save CONFIG.json --revision N [--registry ID]
moguri cache registry-remove ID --revision N --confirm-remove
moguri cache token ID|clear-token ID   Credentials only through piped stdin
moguri github browse REQUEST.json|preview ACTION.json --project ID [--workspace ID --session ID]
moguri github execute ACTION.json --project ID --digest SHA --confirm-review [--confirmations PHRASES.json]
moguri github history|read ID|wait ID|stop ID   Actual original operations, no retry
moguri github acknowledge ID --revision N --digest ORIGINAL_INPUT_SHA --confirm-review
moguri linear status|import PROJECT_ID [CURSOR]
moguri linear token|clear-token    Read a personal API key from piped stdin
moguri linear catalog RESOURCE [CURSOR|-] [ISSUE_UUID] --project ID
moguri linear issue UUID|preview INPUT.json --project ID
moguri linear execute INPUT.json --project ID --digest SHA --confirm-review
moguri linear history|read ID|wait ID|stop ID   Actual retained results and ownership

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
    const args = group === "desktop" ? [fileURLToPath(new URL("..", import.meta.url))] : [`${root}tui.mjs`, ...(values.project ? ["--project", values.project] : []), ...(values.profile ? ["--profile", values.profile] : [])];
    const child = spawn(runtime, args, { stdio: "inherit", env: { ...process.env, ...(values.profile ? { MOGURI_PROFILE_ID: values.profile } : {}) } });
    await new Promise<void>((resolve, reject) => { child.on("error", reject); child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`Moguri ${group} exited with ${code}.`))); });
    return;
  }
  if (group === "service") {
    if (!action || !["stop", "restart", "info"].includes(action)) throw new Error("Use service info, service stop or service restart.");
    if (action === "stop" || action === "restart") await stopMoguriService(undefined, { preserveTerminals: action === "restart" });
    if (action !== "stop") {
      const connection = await ensureConnection({ servicePath: sdkServicePath() });
      console.log(JSON.stringify({ pid: connection.pid, protocolVersion: connection.protocolVersion, stateDir: stateDirectory() }));
    }
    return;
  }
  const sdk = await connectMoguri({ profileId: values.profile ?? process.env.MOGURI_PROFILE_ID });
  let keep = false;
  const output = (value: unknown) => console.log(typeof value === "string" ? value : JSON.stringify(value, null, 2));
  const waitForJob = async (jobId: string, stop: () => Promise<unknown>, label = "Dictation", result?: () => Promise<unknown>) => {
    const cancel = () => { void stop().catch((error: unknown) => console.error(`${label} stop was not confirmed: ${error instanceof Error ? error.message : "inspect the active job"}`)); };
    process.once("SIGINT", cancel);
    try {
      const job = await sdk.jobs.wait(jobId);
      if (job.status !== "completed") { output(job); throw new Error(job.error ?? `${label} ${job.status}; no success was recorded.`); }
      if (result) output(await result()); else { output(job); output(await sdk.mcp.readResult(jobId)); }
    } finally { process.off("SIGINT", cancel); }
  };
  const waitForGeneration = async (id: string) => {
    const cancel = () => { void sdk.candidates.stopGeneration(id).catch((error: unknown) => console.error(`Generation stop was not confirmed: ${error instanceof Error ? error.message : "inspect its original operation"}`)); };
    process.once("SIGINT", cancel);
    try {
      const result = await sdk.candidates.waitGeneration(id); output(result);
      if (result.generation.status !== "proposed") throw new Error(result.generation.diagnostic ?? `Generation ${result.generation.status}; no proposal success was inferred.`);
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
    if (group === "runtime") {
      if (args.length || action && !["status", "power-retry"].includes(action)) throw new Error("Use runtime status or runtime power-retry. No model or execution environment is changed.");
      if (action === "power-retry") await sdk.runtime.retryPower();
      output(await sdk.runtime.status());
    } else if (group === "updates") {
      if ((!action || action === "status") && !args.length) output(await sdk.application.updates.status());
      else if (action === "history" && !args.length) output(await sdk.application.updates.history());
      else if (action === "read" && args.length === 1) output(await sdk.application.updates.read(args[0]!));
      else if (action === "check" && !args.length) output(await sdk.application.updates.check());
      else if (action === "cancel" && args.length === 1) output(await sdk.application.updates.cancel(args[0]!));
      else if (action === "install-preview" && args.length === 1) output(await sdk.application.updates.installPreview(args[0]!));
      else if ((action === "token" || action === "clear-token") && !args.length) { await sdk.application.updates.setToken(action === "token" ? await credential(512) : null); output({ configured: action === "token" }); }
      else throw new Error("Use updates status, history, read/check/cancel, token/clear-token or install-preview ID. The separate PAT must use stdin; no token, application replacement or restart is inferred from model output.");
    } else if (group === "storage") {
      if ((!action || action === "status") && !args.length) output(await sdk.application.storage.status());
      else if (action === "preview" && args.length === 1) output(await sdk.application.storage.preview(args[0]!));
      else if (action === "move" && args.length === 1 && values.digest && values["confirm-write"]) {
        const storage = (await sdk.application.storage.status()).storage;
        if (!storage.locatorDirectory) throw new Error("The actual runtime has no configured state-location authority.");
        const accepted = await sdk.application.storage.relocate(args[0]!, values.digest, true);
        sdk.disconnect();
        output(await waitForStorageRelocation(storage.locatorDirectory, accepted.id, accepted.keyId));
      } else throw new Error("Use storage status, preview PATH or move PATH --digest REVIEW_SHA --confirm-write. This explicitly stops all profile writers, preserves authenticated terminals and requires client restart.");
    } else if (group === "notification-sounds") {
      if ((!action || action === "list") && !args.length) output(sdk.notifications.list());
      else if (action === "read" && args.length === 1) output((await sdk.notifications.sound(args[0]!)).sound);
      else if (action === "import" && args.length === 1 && values["confirm-write"]) {
        const sound = await loadNotificationSoundFile(args[0]!);
        output(await sdk.notifications.importSound(sound.name, audioFromBase64(sound.audio)));
      } else if (action === "remove" && args.length === 1 && values.digest && values["confirm-remove"]) output(await sdk.notifications.removeSound(args[0]!, values.digest, true));
      else throw new Error("Use notification-sounds list, read ID, import FILE.wav --confirm-write or remove ID --digest SHA --confirm-remove. Sound choices use shared notification settings; playback is desktop-only.");
    } else if (group === "progress") {
      if (!values.session) throw new Error("Choose --session ID to inspect its actual bound plan.");
      output(await sdk.sessions.progress(values.session));
    } else if (group === "agent-terminal") {
      if (!values.session) throw new Error("Choose --session ID for its exact Agent command output.");
      if ((!action || action === "list") && args.length === 0) output(await sdk.agentTerminals.list(values.session));
      else if (action === "list" && args.length === 2 && /^\d+$/.test(args[0]!) && Number.isSafeInteger(Number(args[0]))) output(await sdk.agentTerminals.list(values.session, { before: { sequence: Number(args[0]), id: args[1]! } }));
      else if (action === "read" && args[0] && args.length <= 2 && (!args[1] || args[1] === "tail" || /^\d+$/.test(args[1]) && Number.isSafeInteger(Number(args[1])))) {
        output(await sdk.agentTerminals.read(values.session, args[0], args[1] === "tail" ? { tail: true } : { offset: Number(args[1] ?? 0) }));
      } else throw new Error("Use agent-terminal list [SEQUENCE ID] or agent-terminal read COMMAND_ID [UTF8_OFFSET|tail] with --session ID. No private console was accessed.");
    } else if (group === "activity") {
      if (!values.session) throw new Error("Choose --session ID for exact retained activity.");
      if ((!action || action === "list") && args.length === 0) output(await sdk.activity.list(values.session));
      else if (action === "list" && args.length === 2 && /^\d+$/.test(args[0]!) && Number.isSafeInteger(Number(args[0]))) output(await sdk.activity.list(values.session, { before: { sequence: Number(args[0]), id: args[1]! } }));
      else if (action === "turn" && args[0] && args.length === 1) output(await sdk.activity.turn(values.session, args[0]));
      else if (action === "read" && args[0] && (args[1] === "arguments" || args[1] === "output") && args.length <= 3) {
        if (args[2] && (!/^\d+$/.test(args[2]) || !Number.isSafeInteger(Number(args[2])))) throw new Error("Use a returned UTF-8 byte offset.");
        output(await sdk.activity.read(values.session, args[0], args[1], { offset: Number(args[2] ?? 0) }));
      } else throw new Error("Use activity list [SEQUENCE ID], activity turn ID or activity read ID arguments|output [UTF8_OFFSET] with --session ID.");
    } else if (group === "status") {
      output({ protocolVersion: snapshot.protocolVersion, profileId: snapshot.profileId, projects: snapshot.projects, sessions: snapshot.sessions.slice().sort(compareSessionOrder).map(({ id, projectId, title, status, mode, parentSessionId, order, groupId, pinned }) => ({ id, projectId, title, status, mode, parentSessionId, order, groupId, pinned })) });
    } else if (["tools", "tool", "tool-result", "state", "watch", "coordinate"].includes(group)) {
      if (!values.session) throw new Error("Choose --session ID. No previous project/root or session authority is inherited.");
      const value = await sdk.slash(values.session, `/${group}${action ? ` ${[action, ...args].join(" ")}` : ""}`, "cli");
      output(value.kind === "text" ? values.json ? JSON.parse(value.text) : value.text : value);
    } else if (group === "knowledge" || group === "marketplace" || group === "hooks" || group === "capability" || group === "containment") {
      output(await workspaceFeatureCommand(sdk, group, action, args, values));
    } else if (group === "terminal") {
      if (!action || action === "list") {
        const terminals = snapshot.terminals.filter((terminal) => !values.session || terminal.sessionId === values.session);
        output({ terminals, owners: snapshot.terminalOwners, warning: "Owners are profile/Local-or-pinned-SSH scoped. Actual env/peer/root remain captured; bounded volatile output, no agent context, automatic replacement or input replay." });
      } else if (action === "open" && values.session) output(await sdk.terminal.open(values.session, 80, 24, undefined, values.root));
      else if (action === "global" || action === "open-global") throw new Error("Global Terminal was removed. Use terminal open --session ID. Existing consoles remain available through list/read/reconcile/close.");
      else if (action === "default-root") output(await sdk.terminal.defaultRoot());
      else if (action === "read" && args[0]) output(await sdk.terminal.read(args[0]));
      else if (action === "reconcile" && args[0]) { await sdk.terminal.reconcile(args[0]); output(sdk.getState().snapshot!.terminals.find((terminal) => terminal.id === args[0])); }
      else if (action === "owner-reconcile" && args[0]) { await sdk.terminal.reconcileOwner(args[0]); output(sdk.getState().snapshot!.terminalOwners.find((owner) => owner.id === args[0])); }
      else if (action === "owner-acknowledge" && args[0] && values["confirm-review"]) output(await sdk.terminal.acknowledgeOwner(args[0], true));
      else if (action === "close" && args[0]) output(await sdk.terminal.close(args[0]));
      else if (action === "acknowledge" && args[0] && values["confirm-review"]) output(await sdk.terminal.acknowledge(args[0], true));
      else if (action === "input" && args[0]) {
        if (process.stdin.isTTY) throw new Error("Pipe the exact UTF-8 input through stdin. Terminal input is not accepted in command arguments or automatically replayed.");
        process.stdin.setEncoding("utf8");
        let data = "";
        for await (const chunk of process.stdin) { data += String(chunk); if (Buffer.byteLength(data) > 65536) throw new Error("One terminal input batch is limited to 64 KiB; nothing was submitted."); }
        await sdk.terminal.input(args[0], data); output({ acknowledged: true, warning: "Accepted by the exact owned PTY, not proof a shell command succeeded. No input was persisted or replayed." });
      } else throw new Error("Use terminal list/open/default-root/read/reconcile/close/input/acknowledge. Open needs --session ID; project-free open needs --root PATH. Inspection acknowledgements need --confirm-review.");
    } else if (group === "profile" || group === "profiles") {
      if (!action || action === "list") output(await sdk.profiles.list());
      else if (action === "create" && args.length) { const created = await sdk.profiles.create(args.join(" "), values.color ?? null); output(await sdk.profiles.wait(created.id!)); }
      else if (action === "update" && args[0] && args[1]) output(await sdk.profiles.update(args[0], parse(ProfileChangesSchema, JSON.parse(await readFile(args[1], "utf8"))), expectedRevision()));
      else if (action === "retry" && args[0] && values["confirm-review"]) { await sdk.profiles.retry(args[0], expectedRevision(), true); output(await sdk.profiles.wait(args[0])); }
      else if (action === "stop" && args[0]) output(await sdk.profiles.stop(args[0]));
      else if (action === "defaults" && args[0]) output(await sdk.profiles.defaults(parse(ControlDefaultsSchema, JSON.parse(await readFile(args[0], "utf8"))), expectedRevision()));
      else throw new Error("Use profile list/create/update/retry/stop/defaults. Updates need an observed revision; retry requires explicit --confirm-review after resource inspection. Use --profile ID to select scope.");
    } else if (group === "context") {
      if (!values.session) throw new Error("Choose --session ID for this exact attachment scope.");
      if (action === "documents") { output(await sdk.attachments.listDocuments(values.session, parse(DocumentListOptionsSchema, JSON.parse(values.filters ?? "{}")))); return; }
      if (!args[0]) throw new Error("Choose an explicit source path/reference.");
      if (action === "document") {
        const captureId = values["capture-id"] ?? crypto.randomUUID();
        console.error(`Local document extraction / capture ${captureId}. No model call.`);
        output(await sdk.attachments.document(values.session, args[0], { captureId }));
      } else if (action === "file" || action === "image") output(await sdk.attachments.file(values.session, args[0], action === "image" ? "image" : "auto"));
      else if (action === "document-read") output(await sdk.attachments.readDocument(values.session, args[0], parse(DocumentReadOptionsSchema, JSON.parse(values.filters ?? "{}"))));
      else if (action === "document-search") output(await sdk.attachments.searchDocument(values.session, args[0], parse(DocumentSearchOptionsSchema, JSON.parse(values.filters ?? "{}"))));
      else if (action === "cancel") output(await sdk.attachments.cancelDocument(values.session, args[0]));
      else if (action === "original") output(await sdk.attachments.original(values.session, args[0]));
      else if (action === "read") { const result = await sdk.attachments.read(values.session, args[0]); output(result.content.kind === "text" ? result.content.text : { attachment: result.attachment, diagnostic: result.content.kind === "document" ? "Use context document-read/document-search for bounded extracted content. Formulas are inert and OCR is unavailable." : "Use SDK/desktop for private image bytes; no clipboard capability is assumed." }); }
      else if (action === "folder" || action === "github" || action === "session") {
        if (values.digest && values["confirm-review"]) output(action === "folder" ? await sdk.attachments.folder(values.session, args[0], values.digest, true) : action === "github" ? await sdk.attachments.github(values.session, args[0], "public", values.digest, true) : await sdk.attachments.session(values.session, args[0], values.digest, true));
        else if (values.digest || values["confirm-review"]) throw new Error("Use both --digest SHA256 and --confirm-review after inspecting the source snapshot.");
        else output(action === "folder" ? await sdk.attachments.folderPreview(values.session, args[0]) : action === "github" ? await sdk.attachments.githubPreview(values.session, args[0]) : await sdk.attachments.sessionPreview(values.session, args[0]));
      } else throw new Error("Use context file/image/document/document-read/document-search/original/cancel/folder/github/session/read. No source is attached implicitly.");
    } else if (group === "question") {
      if (action === "list") output(snapshot.questions.filter((question) => !values.session || question.sessionId === values.session));
      else if (action === "read" && args[0]) { const question = snapshot.questions.find((question) => question.id === args[0]); if (!question) throw new Error("Choose an actual question ID from this profile."); output(question); }
      else if (action === "answer" && args[0] && args[1]) output(await sdk.questions.answer(args[0], await readFile(args[1], "utf8"), expectedRevision()));
      else if (action === "answer-other" && args[0] && args[1]) output(await sdk.questions.answerOther(args[0], await readFile(args[1], "utf8"), expectedRevision()));
      else if (action === "answer-draft" && args[0]) output(await sdk.questions.answerDraft(args[0], expectedRevision()));
      else throw new Error("Use question list/read, answer or answer-other ID ANSWER_FILE --revision N, or answer-draft ID --revision N. Answers do not authorize tools or change policy.");
    } else if (group === "repository") {
      if (!values.session) throw new Error("Choose an explicit --session ID for the actual Local/Remote repository binding.");
      if (action === "preview") output(await sdk.repositories.preview(values.session));
      else if (action === "state") output(await sdk.repositories.state(values.session));
      else if (action === "refresh" && values.digest && values["confirm-review"]) output(await sdk.repositories.refresh(values.session, values.digest, expectedRevision(), true));
      else if (action === "clear" && values["confirm-review"]) output(await sdk.repositories.clear(values.session, expectedRevision(), true));
      else if (action === "stop" && args[0]) {
        const job = snapshot.jobs.find((job) => job.id === args[0] && job.sessionId === values.session && job.kind === "repository.refresh");
        if (!job) throw new Error("Choose an exact metadata refresh owned by that session.");
        output(await sdk.jobs.cancel(job.id));
      } else throw new Error("Use repository preview/state, refresh --digest BINDING --revision N --confirm-review, clear --revision N --confirm-review, or stop JOB_ID, with an explicit --session.");
    } else if (group === "telemetry") {
      if (action === "storage") {
        if (values.filters || values.project || values.folder || values.session || values.model || values.provider || values.role) throw new Error("Storage is a current profile measurement, not a dated/project/model view. Select --profile ID instead.");
        output(await sdk.telemetry.storage());
      } else if (action === "operations") {
        if (values.filters && Buffer.byteLength(values.filters) > 64 * 1024) throw new Error("Telemetry filters are limited to 64 KiB of JSON.");
        const filters: unknown = values.filters ? JSON.parse(values.filters) : {};
        if (!isRecord(filters) || Object.hasOwn(filters, "type")) throw new Error("Use an object of operation filter fields, not a query type.");
        const query = parse(TelemetryQuerySchema, { ...filters, ...(values.project ? { projectId: values.project } : {}), ...(values.folder ? { folderId: values.folder } : {}), ...(values.session ? { sessionId: values.session } : {}), ...(values.model ? { modelId: values.model } : {}), ...(values.provider ? { providerId: values.provider } : {}), ...(values.role ? { role: parse(ModelRoleSchema, values.role) } : {}), type: "telemetry.operations" });
        output(await sdk.query(query));
      } else throw new Error("Use telemetry operations or storage. Operation results and storage are not model usage or physical disk totals.");
    } else if (group === "budget") {
      if (action === "status" && args[0]) output(await sdk.budgets.status(args[0]));
      else if (action === "dashboard" || action === "calls" || action === "plans") {
        if (values.filters && Buffer.byteLength(values.filters) > 64 * 1024) throw new Error("Usage filters are limited to 64 KiB of JSON.");
        const filters: unknown = values.filters ? JSON.parse(values.filters) : {};
        if (!isRecord(filters) || Object.hasOwn(filters, "type")) throw new Error("Use a JSON object of usage filter fields, not a query type.");
        const query = parse(BudgetQuerySchema, { ...filters, ...(values.project ? { projectId: values.project } : {}), ...(values.folder ? { folderId: values.folder } : {}), ...(values.session ? { sessionId: values.session } : {}), ...(values.model ? { modelId: values.model } : {}), ...(values.provider ? { providerId: values.provider } : {}), ...(values.role ? { role: parse(ModelRoleSchema, values.role) } : {}), type: action === "calls" ? "budget.calls" : action === "plans" ? "budget.plans" : "budget.dashboard" });
        if (query.type === "budget.status") throw new Error("Use dashboard, calls or plans filters.");
        output(await sdk.query(query));
      }
      else if ((action === "set" || action === "policy" || action === "global") && args[action === "set" ? 1 : 0] && values["confirm-review"]) {
        const path = args[action === "set" ? 1 : 0]!, metadata = await stat(path);
        if (!metadata.isFile() || metadata.size > 64 * 1024) throw new Error("Choose a regular budget JSON file up to 64 KiB.");
        const value: unknown = JSON.parse(await readFile(path, "utf8"));
        console.error(BUDGET_WARNING);
        if (action === "global") output(await sdk.profiles.globalBudget(value === null ? null : parse(BudgetLimitSchema, value), expectedRevision(), true));
        else if (action === "policy") output(await sdk.budgets.policy(value === null ? null : parse(BudgetLimitSchema, value), expectedRevision(), true));
        else {
          const session = snapshot.sessions.find((session) => session.id === args[0]);
          if (!session) throw new Error("Choose an existing session ID.");
          await sdk.sessions.configure(session.id, { ...session.controls, budget: parse(SessionBudgetSchema, value) }, session.revision);
          output(await sdk.budgets.status(session.id));
        }
      } else throw new Error("Use budget status SESSION, dashboard/calls/plans [--filters JSON], set SESSION BUDGET.json --confirm-review, or policy/global LIMIT_OR_NULL.json --revision N --confirm-review. Finite limits require explicit basis: estimate.");
    } else if (group === "decisions") {
      output(await decisionCommand(sdk, action, args, values));
    } else if (group === "winddown") {
      output(await winddownCommand(sdk, action, args, values));
    } else if (group === "compound") {
      output(await compoundCommand(sdk, action, args, values));
    } else if (group === "roles") {
      if (action === "contract") {
        if (args.length !== 2 || !/^\d+$/.test(args[1]!)) throw new Error("Use roles contract SEQUENCE_ID ROLE_INDEX to inspect original declared checks; no model, quality or approval is implied.");
        output(await sdk.roleSequences.contract(args[0]!, Number(args[1])));
      } else {
        if (!action || args.length > 1 || args[0] !== undefined && !/^\d+$/.test(args[0])) throw new Error("Use roles SEQUENCE_ID [ROLE_INDEX] or roles contract SEQUENCE_ID ROLE_INDEX. These reads never dispatch a model.");
        output(await sdk.roleSequences.read(action, args[0] === undefined ? undefined : Number(args[0])));
      }
    } else if (group === "candidate") {
      if (action === "list") output(snapshot.candidates);
      else if (action === "eligibility" && values.session && !args.length && !values.project) output(await sdk.candidates.eligibility(values.session));
      else if (action === "read" && args[0]) output(await sdk.candidates.read(args[0]));
      else if (action === "role-proposal" && args.length === 1) output(await sdk.candidates.roleProposal(args[0]!));
      else if (action === "generated" && args.length === 1) output(await sdk.candidates.generation(args[0]!));
      else if (action === "generation-stop" && args.length === 1) output(await sdk.candidates.stopGeneration(args[0]!));
      else if (action === "generation-wait" && args.length === 1) await waitForGeneration(args[0]!);
      else if ((action === "generate-preview" || action === "generate") && args.length === 1 && values.session && values.workspace && !values.project) {
        if (action === "generate" && (!values.digest || !values["confirm-cost"])) throw new Error("Generation requires its exact --digest preview and --confirm-cost. No model was called.");
        const metadata = await stat(args[0]!);
        if (!metadata.isFile() || metadata.size > 32 * 1024) throw new Error("Choose a regular generation-selection JSON file up to 32 KiB.");
        const text = await readFile(args[0]!, "utf8");
        if (Buffer.byteLength(text) > 32 * 1024) throw new Error("Generation-selection JSON grew beyond 32 KiB. Nothing was truncated.");
        const input = parse(CandidateGenerationInputSchema, JSON.parse(text));
        if (action === "generate-preview") output(await sdk.candidates.generatePreview(values.session, values.workspace, input));
        else { const created = await sdk.candidates.generate(values.session, values.workspace, input, values.digest!, true); await waitForGeneration(created.id!); }
      }
      else if ((action === "preview" || action === "stage") && args.length === 1 && values.session && values.workspace && !values.project) {
        if (values.generation !== undefined && values["role-sequence"] !== undefined) throw new Error("Choose one exact generation or final-role origin, not both. No model attribution or file write was admitted.");
        if (values["role-sequence"] !== undefined && !values["role-sequence"].trim()) throw new Error("Pass the exact non-empty retained role sequence ID. No unverified fallback was used.");
        if (action === "stage" && (!values.digest || !values["confirm-write"])) throw new Error("Candidate staging requires the exact --digest preview and --confirm-write after reviewing its roots/bases/bytes.");
        const metadata = await stat(args[0]!);
        if (!metadata.isFile() || metadata.size > 32 * 1024) throw new Error("Choose a regular candidate patch JSON file up to 32 KiB.");
        const text = await readFile(args[0]!, "utf8");
        if (Buffer.byteLength(text) > 32 * 1024) throw new Error("The candidate JSON grew beyond its exact 32-KiB limit.");
        const patch = parse(CandidatePatchSchema, JSON.parse(text));
        const origin = values["role-sequence"] ? { roleSequenceId: values["role-sequence"] } : undefined;
        if (action === "preview") output(await sdk.candidates.preview(values.session, values.workspace, patch, origin));
        else {
          const created = await sdk.candidates.stage(values.session, values.workspace, patch, values.digest!, origin ?? values.generation);
          const candidate = await sdk.candidates.read(created.id!);
          await waitForJob(candidate.candidate.stageIntent.jobId, () => sdk.candidates.stop(created.id!), "Candidate stage", () => sdk.candidates.read(created.id!));
        }
      } else if (action === "apply-preview" && args.length === 1 && values.session) output(await sdk.candidates.applyPreview(args[0]!, values.session));
      else if (action === "apply" && args.length === 1 && values.session && values.digest && values["confirm-write"]) {
        await sdk.candidates.apply(args[0]!, values.session, expectedRevision(), values.digest);
        const candidate = await sdk.candidates.read(args[0]!);
        if (!candidate.candidate.applyIntent) throw new Error("No original candidate apply job was retained. Inspect its intent; no success was inferred.");
        await waitForJob(candidate.candidate.applyIntent.jobId, () => sdk.candidates.stop(args[0]!), "Candidate apply", () => sdk.candidates.read(args[0]!));
      } else if (action === "reject" && args.length === 1 && values["confirm-review"]) output(await sdk.candidates.reject(args[0]!, expectedRevision(), true));
      else if (action === "stop" && args.length === 1) output(await sdk.candidates.stop(args[0]!));
      else if (action === "wait" && args.length === 1) {
        const candidate = await sdk.candidates.read(args[0]!), jobId = candidate.candidate.applyIntent?.jobId ?? candidate.candidate.stageIntent.jobId;
        await waitForJob(jobId, () => sdk.candidates.stop(args[0]!), "Candidate", () => sdk.candidates.read(args[0]!));
      } else throw new Error("Use candidate eligibility --session ID; role-proposal SEQUENCE_ID; generate-preview/generate INPUT.json --session SOURCE --workspace STAGE [--digest SHA --confirm-cost], generated/generation-wait/generation-stop ID; or list/read, preview/stage PATCH.json [--role-sequence ID], apply-preview/apply, reject/stop/wait. Creation needs an explicit Git project; staging and application require separate exact reviews.");
    } else if (group === "artifact") {
      if (action === "list") output(snapshot.artifacts);
      else if (action === "create" && args[0]) {
        if (values.session && values.project) throw new Error("Choose an origin --session or explicit --project scope, not both.");
        const document = parse(ArtifactDraftSchema, JSON.parse(await readFile(args[0], "utf8")));
        output(await sdk.artifacts.create(values.session ?? null, { ...document, ...(!values.session ? { projectId: values.project ?? null } : {}) }));
      } else if (action === "read" && args[0]) output(await sdk.artifacts.read(args[0], values.revision === undefined ? undefined : expectedRevision()));
      else if (action === "history" && args[0]) output(await sdk.artifacts.history(args[0]));
      else if (action === "materialization" && args[0]) output(await sdk.artifacts.materialization(args[0]));
      else if (action === "stop-materialization" && args[0]) { await sdk.artifacts.materialization(args[0]); output(await sdk.jobs.cancel(args[0])); }
      else if (action === "update" && args[0] && args[1]) output(await sdk.artifacts.update(args[0], parse(ArtifactChangesSchema, JSON.parse(await readFile(args[1], "utf8"))), expectedRevision()));
      else if ((action === "source" || action === "promote") && args[0] && values.session) {
        const sourceKind = values["source-type"] ?? "message";
        if (sourceKind !== "message" && sourceKind !== "tool") throw new Error("Choose --source-type message or tool explicitly.");
        if (action === "source") output(await sdk.artifacts.source(values.session, sourceKind, args[0]));
        else {
          if (!args[1] || !args[2] || !values.digest) throw new Error("Preview the source first, then use artifact promote SOURCE_ID KIND NAME --session ID --digest REVIEWED_SHA256.");
          output(await sdk.artifacts.promote(values.session, { sourceKind, sourceId: args[0], kind: parse(ArtifactKindSchema, args[1]), name: args.slice(2).join(" "), expectedDigest: values.digest }));
        }
      } else if ((action === "archive" || action === "restore") && args[0]) output(await sdk.artifacts.update(args[0], { status: action === "archive" ? "archived" : "active" }, expectedRevision()));
      else if (action === "delete" && args[0] && values["confirm-remove"]) output(await sdk.artifacts.delete(args[0], expectedRevision(), true));
      else if (action === "export" && args[0] && values.output) output(await saveArtifactExport(values.output, (await sdk.artifacts.export(args[0])).export));
      else throw new Error("Use artifact list/read/history/create/update/source/promote/archive/restore/delete/export. Deletes need --revision and --confirm-remove; exports need an absolute new --output path.");
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
    } else if (group === "sandbox") {
      const paths = async (filename: string): Promise<string[]> => {
        const info = await stat(filename);
        if (!info.isFile() || info.size > 1024 * 1024) throw new Error("Native path selections require an explicit regular JSON file up to 1 MiB.");
        const text = await readFile(filename, "utf8");
        if (Buffer.byteLength(text) > 1024 * 1024) throw new Error("Native path selection grew beyond 1 MiB. Nothing was staged or published.");
        const value: unknown = JSON.parse(text);
        if (!Array.isArray(value) || !value.every((path) => typeof path === "string")) throw new Error("Native path selection must be an exact JSON array of relative file paths. Root and actor are not client input.");
        return value;
      };
      if (action === "setup" && args.length <= 1) {
        const status = await sdk.sandbox.setup.status();
        output(status.setup.supported ? await sdk.sandbox.setup.review(args[0]) : status);
      } else if (action === "enable" && args.length === 1 && values.digest && values["confirm-review"]) {
        const admitted = await sdk.sandbox.setup.apply({ version: args[0]!, digest: values.digest, settingsRevision: expectedRevision() });
        output(await sdk.sandbox.setup.wait(admitted.id!));
      } else if (action === "updates" && !args.length) { const admitted = await sdk.sandbox.setup.check(); output(await sdk.sandbox.setup.wait(admitted.id!)); }
      else if (action === "prepare-version" && args.length === 1 && values["confirm-review"]) {
        const admitted = await sdk.sandbox.setup.prepare(args[0]!); output(await sdk.sandbox.setup.wait(admitted.id!));
      } else if (action === "setup-operation" && args.length === 1) output(await sdk.sandbox.setup.operation(args[0]!));
      else if (action === "setup-cancel" && args.length === 1) output(await sdk.sandbox.setup.cancel(args[0]!));
      else if (action === "status" && !args.length) output(await sdk.sandbox.status());
      else if (action === "runs" && !args.length) output({ executions: snapshot.sandboxExecutions ?? [], publications: snapshot.sandboxPublications ?? [] });
      else if (action === "probe" && !args.length && values["confirm-review"]) { await sdk.sandbox.probe(); output(await sdk.sandbox.status()); }
      else if (action === "preview" && args.length === 1 && values.session) output(await sdk.sandbox.preview(values.session, await paths(args[0]!)));
      else if (action === "prepare" && args.length === 1 && values.session && values.digest && values["confirm-review"]) output(await sdk.sandbox.prepare(values.session, await paths(args[0]!), values.digest, expectedRevision()));
      else if (action === "execution" && args.length === 1) output(await sdk.sandbox.execution(args[0]!));
      else if (action === "result" && args.length === 1) output(await sdk.sandbox.result(args[0]!));
      else if (action === "stop" && args.length === 1) output(await sdk.sandbox.stop(args[0]!));
      else if (action === "reconcile" && args.length === 1 && values["confirm-review"]) { await sdk.sandbox.reconcile(args[0]!); output(await sdk.sandbox.execution(args[0]!)); }
      else if (action === "publish-preview" && args.length === 2) output(await sdk.sandbox.publicationPreview(args[0]!, await paths(args[1]!)));
      else if (action === "publish" && args.length === 2 && values.digest && values["confirm-write"]) {
        const created = await sdk.sandbox.publish(args[0]!, await paths(args[1]!), values.digest, expectedRevision());
        const record = (await sdk.sandbox.publication(created.id!)).publication;
        await waitForJob(record.jobId, () => sdk.jobs.cancel(record.jobId), "Native source publication", () => sdk.sandbox.publication(record.id));
      } else if (action === "publication" && args.length === 1) output(await sdk.sandbox.publication(args[0]!));
      else if (action === "publication-stop" && args.length === 1) { const record = (await sdk.sandbox.publication(args[0]!)).publication; output(await sdk.jobs.cancel(record.jobId)); }
      else if (action === "publication-wait" && args.length === 1) {
        const record = (await sdk.sandbox.publication(args[0]!)).publication;
        await waitForJob(record.jobId, () => sdk.jobs.cancel(record.jobId), "Native source publication", () => sdk.sandbox.publication(record.id));
      } else throw new Error("Use sandbox setup [VERSION], enable VERSION --digest SHA --revision N --confirm-review, updates, prepare-version VERSION --confirm-review, or setup-operation/setup-cancel ID. Advanced source publication requires publish RUN_ID PATHS.json --digest SHA --revision N --confirm-write. No setup command starts a model turn.");
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
      else if (action === "evidence" && args.length === 1) output(await sdk.models.evidence(args[0]!));
      else if (action === "refresh") { await sdk.models.refresh(); output(sdk.getState().snapshot!.provider); }
      else if (action === "token" && args[0]) output(await sdk.models.setToken(args[0], await credential()));
      else if (action === "clear-token" && args[0]) output(await sdk.models.clearToken(args[0]));
      else throw new Error("Use models list, refresh, evidence MODEL_ID, token ENDPOINT or clear-token ENDPOINT. Evidence is an explicit bounded account-catalogue read, not inference or independence. Configure endpoint URLs/limits in shared settings.");
    } else if (group === "slash") {
      if (!values.session || !action) throw new Error("Use slash '/COMMAND ARGUMENT' --session ID. Native panels are returned as typed actions, not opened by this CLI.");
      if (/^\/budget\s+(?:set|profile|global)\b/.test(action)) console.error(BUDGET_WARNING);
      const result = await sdk.slash(values.session, [action, ...args].join(" "), "cli");
      if (result.kind === "export" && result.path) output(await saveArtifactExport(result.path, result.document)); else output(result);
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
      else if (action === "reorder" && args.length) output(await sdk.sessions.reorder(args));
      else {
        if (!values.session) throw new Error("Choose --session ID from moguri status.");
        if (action === "rename") output(await sdk.sessions.rename(values.session, args.join(" ")));
        else if (action === "mode" && (args[0] === "agent" || args[0] === "read-only")) output(await sdk.sessions.mode(values.session, args[0]));
        else if (action === "spawn" && (args[0] === "agent" || args[0] === "side")) output(await sdk.sessions.spawn(values.session, args[0], args.slice(1).join(" ") || undefined));
        else if (action === "organize" && args[0]) output(await sdk.sessions.organize(values.session, parse(SessionChangesSchema, JSON.parse(await readFile(args[0], "utf8"))), expectedRevision()));
        else if (action === "model-settings" && args[0]) {
          const options = parse(ModelOptionsSchema, JSON.parse(await readFile(args[0], "utf8")));
          output(await sdk.sessions.modelOptions(values.session, options, expectedRevision(), Object.hasOwn(options, "thinkingEffort") || undefined));
        }
        else if (action === "context") output(await sdk.sessions.context(values.session));
        else if (action === "delete" && values["confirm-remove"]) output(await sdk.sessions.delete(values.session, true, expectedRevision()));
        else if (action && ["archive", "restore", "stop", "resume"].includes(action)) output(await sdk.command({ type: `session.${action}` as "session.archive" | "session.restore" | "session.stop" | "session.resume", sessionId: values.session }));
        else throw new Error("Use session rename/mode/spawn/organize/archive/restore/stop/resume/delete. Deletion needs --confirm-remove and the observed --revision.");
      }
    } else if (group === "project") {
      if (!args[0]) throw new Error("Choose the project ID from moguri status.");
      if (action === "add") output(await sdk.projects.add(args[0]));
      else if (action === "clone") {
        if (!args[1] || !values["confirm-write"]) throw new Error("Use project clone URL ABSOLUTE_NEW_PATH --confirm-write. Partial clone files are retained, never automatically removed or retried.");
        const result = await sdk.projects.clone(args[0], args[1], true);
        await waitForJob(result.id!, () => sdk.jobs.cancel(result.id!), "Repository clone");
      }
      else if (action === "get") output(await sdk.projects.configuration(args[0]));
      else if (action === "removal-preview") output(await sdk.artifacts.projectPreview(args[0]));
      else if (action === "export-artifacts" && values.output) output(await saveArtifactExport(values.output, (await sdk.artifacts.projectExport(args[0])).export));
      else if (action === "materialize-preview") output(await sdk.artifacts.materializePreview(args[0], { ...(values.workspace ? { workspaceId: values.workspace } : {}), ...(values.branch ? { commitBranch: values.branch } : {}) }));
      else if (action === "materialize-artifacts" && values.digest && values["confirm-write"]) {
        const job = await sdk.artifacts.materialize(args[0], values.digest, { ...(values.workspace ? { workspaceId: values.workspace } : {}), ...(values.branch ? { commitBranch: values.branch } : {}) });
        await waitForJob(job.id!, () => sdk.jobs.cancel(job.id!), "Artifact repository copy", () => sdk.artifacts.materialization(job.id!));
      }
      else if (action === "sources") output(await sdk.projects.sources(args[0]));
      else if (action === "repositories") output(await sdk.projects.repositories(args[0]));
      else if (action === "diff") output(await sdk.projects.git(args[0]));
      else if (action === "porto") output(await sdk.projects.porto(args[0]));
      else if (action === "set" && args[1]) output(await sdk.projects.configure(args[0], parse(ProjectSettingsSchema, JSON.parse(await readFile(args[1], "utf8"))), expectedRevision()));
      else if (action === "relocate" && args[1]) output(await sdk.projects.relocate(args[0], args[1], expectedRevision()));
      else if (action === "remove" && values["confirm-remove"]) {
        const artifacts = values.artifacts ? parse(ProjectArtifactChoiceSchema, { action: values.artifacts, expectedDigest: values.digest, ...(values["exported-digest"] ? { exportedDigest: values["exported-digest"] } : {}), ...(values["materialization-id"] ? { materializationId: values["materialization-id"] } : {}) }) : undefined;
        output(await sdk.projects.remove(args[0], true, expectedRevision(), artifacts));
      }
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
        else if (action === "saves") output(await sdk.plans.saves(session.id));
        else if (action === "info" && args[0]) output(await sdk.plans.saveInfo(session.id, args[0]));
        else if (action === "stop" && args[0]) output(await sdk.plans.stopSave(session.id, args[0]));
        else if (action === "capture") output(await sdk.plans.capture(session.id, args[0]));
        else if (action === "save" && args[0] && values.digest) output(await sdk.plans.save(session.id, await readFile(args[0], "utf8"), values.digest, values.binding));
        else throw new Error("Use plan read/capture/saves, info SAVE_ID, stop SAVE_ID, or plan save FILE --digest OBSERVED_SHA256_OR_absent. A partial Remote save is not automatically replayed.");
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
    } else if (group === "github" || group === "linear" && action !== undefined && ["catalog", "issue", "preview", "execute", "history", "read", "wait", "stop"].includes(action)) {
      output(await integrationCommand(sdk, group, action, args, values));
    } else if (group === "cache" && action === "registries") {
      output(await sdk.cache.registries.list());
    } else if (group === "cache" && action === "registry-save" && args[0]) {
      output(await sdk.cache.registries.save(parse(DependencyRegistryConfigSchema, JSON.parse(await readFile(args[0], "utf8"))), expectedRevision(), values.registry));
    } else if (group === "cache" && action === "registry-remove" && args[0] && values["confirm-remove"]) {
      output(await sdk.cache.registries.remove(args[0], expectedRevision()));
    } else if (group === "cache" && action === "token" && args[0]) {
      output(await sdk.cache.registries.setToken(args[0], await credential(4096)));
    } else if (group === "cache" && action === "clear-token" && args[0]) {
      output(await sdk.cache.registries.clearToken(args[0]));
    } else if (group === "cache") {
      const manager = parse(PackageManagerSchema, args[1]);
      if (!args[0]) throw new Error("Choose an exact Local project and manager: npm/pnpm/python/cargo/go.");
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
      if (values.session) {
        if (values.project || values.workspace) throw new Error("Choose --session for its actual bound environment, or an explicit Local project/workspace; do not combine them.");
        if (action === "index" && !args.length) output(await sdk.memory.indexSession(values.session));
        else if (action === "state" && !args.length) output(await sdk.memory.state(values.session));
        else if (action === "search" && args.length) output(await sdk.memory.searchSession(values.session, args.join(" ")));
        else if (action === "graph") output(await sdk.memory.graphSession(values.session, args.join(" ")));
        else throw new Error("Use memory index/state/search TEXT/graph [PATH] with --session SESSION_ID.");
      } else {
        if (!projectId) throw new Error("Pass an explicit Local project ID, or --session SESSION_ID for its actual environment.");
        if (action === "index") output(await sdk.memory.index(projectId, values.workspace));
        else if (action === "search") output(await sdk.memory.search(projectId, args.slice(1).join(" "), 6, values.workspace));
        else if (action === "graph") output(await sdk.memory.graph(projectId, args[1] ?? "", values.workspace));
        else throw new Error("Use memory index/search/graph PROJECT_ID for Local data, or --session SESSION_ID.");
      }
    } else if (group === "skills" || group === "plugins") {
      if (group === "skills" && action === "sources") output(sdk.settings.get()?.values.skillSources ?? []);
      else if (group === "skills" && action === "find") output(await sdk.skills.find(args.join(" "), { ...(values.session ? { sessionId: values.session } : {}) }));
      else if (group === "skills" && action === "read" && args[0] && values.digest) output(await sdk.skills.read(args[0], values.digest, values.session));
      else {
        if (action !== "import" || !args[0] || !args[1]) throw new Error("Use skills sources/find/read ID --digest SHA, or import PROJECT_ID FILE. Imported capabilities start disabled.");
        output(group === "skills" ? await sdk.capabilities.importSkill(args[0], args[1]) : await sdk.capabilities.importPlugin(args[0], args[1]));
      }
    } else if (group === "dashboard") {
      if (action && !["work", "usage", "cost", "velocity"].includes(action)) throw new Error("Use dashboard work, usage, cost or velocity, with optional --filters JSON.");
      const filters: unknown = values.filters ? JSON.parse(values.filters) : {};
      if (!isRecord(filters) || Object.hasOwn(filters, "type")) throw new Error("Use a dashboard filter object with range and optional projectId.");
      const { DashboardQuerySchema } = await import("../../../packages/sdk/src/index.ts");
      output(await sdk.query(parse(DashboardQuerySchema, { ...filters, ...(values.project ? { projectId: values.project } : {}), type: "dashboard.overview" })));
    } else if (group === "mcp") {
      if (!action) {
        if (!values.session) throw new Error("Bind the gateway to --session SESSION_ID. It cannot approve itself.");
        await serveGatewayMcp(sdk, values.session); keep = true;
      } else if (action === "servers") output(await sdk.mcp.servers(values.session));
      else if (action?.startsWith("remote-")) {
        if (!values.session) throw new Error("Bind Remote MCP review and inspection to --session SESSION_ID.");
        if (action === "remote-calls" && !args.length) output(await sdk.mcp.remoteCalls(values.session));
        else if (action === "remote-call" && args[0] && args.length === 1) output(await sdk.mcp.remoteCall(values.session, args[0]));
        else if (action === "remote-preview" && args[0] && args.length === 1) output(await sdk.mcp.remotePreview(values.session, args[0]));
        else if (action === "remote-grant" && args[0] && args.length === 1 && values.digest && values["confirm-review"]) output(await sdk.mcp.grantRemote(values.session, args[0], values.digest, expectedRevision(), values["forward-access"] === true, true));
        else if (action === "remote-revoke" && args[0] && args.length === 1 && values["confirm-review"]) output(await sdk.mcp.revokeRemote(values.session, args[0], expectedRevision(), true));
        else throw new Error("Use Remote MCP preview/calls/call, or an exact grant/revoke with --confirm-review and observed --revision. Grant also needs --digest; --forward-access independently allows sending access that may be long-lived. Refresh credentials remain local.");
      }
      else if (action === "tools") output(await sdk.mcp.tools(args[0] ?? "builtin", args.slice(1).join(" "), 0, values.session));
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
      } else throw new Error("Use mcp --session ID, mcp servers/tools/auth, mcp remote-preview/grant/revoke/calls/call or mcp token.");
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
