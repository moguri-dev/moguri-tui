import { parseArgs } from "node:util";
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { connectMoguri, stopMoguriService, ensureConnection, stateDirectory, sdkServicePath } from "../../../packages/sdk/src/node.ts";
import { serveGatewayMcp } from "../../../packages/sdk/src/mcp-server.ts";
import { defaultSettings, parse, SettingsSchema, SYSTEM_PROMPT_WARNING, IssueInputSchema, BoardConfigSchema } from "../../../packages/sdk/src/index.ts";

export async function main(argv: string[]): Promise<void> {
  const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, options: {
    help: { type: "boolean" }, session: { type: "string" }, project: { type: "string" },
    "acknowledge-prompt-risk": { type: "boolean" }, "accept-license": { type: "boolean" }, json: { type: "boolean" },
    "accept-dependency-metadata": { type: "boolean" }, "run-scripts": { type: "boolean" }, revision: { type: "string" },
  } });
  const [group = "tui", action, ...args] = positionals;
  if (values.help || group === "help") {
    console.log(`Moguri CLI + SDK

moguri [tui] [--project PATH]       Terminal client
moguri desktop                    Desktop client, same SDK
moguri status                     Project/session IDs and current work state
moguri service restart|stop|info   Explicit owned-service lifecycle
moguri config get|set FILE|reset   Shared, restorable settings
moguri prompt get|set FILE|reset   Editable system prompt (risk acknowledgement required)
moguri memory index PROJECT_ID|search PROJECT_ID TEXT|graph PROJECT_ID
moguri skills import PROJECT_ID SKILL.md
moguri plugins import PROJECT_ID manifest.json
moguri mcp --session SESSION_ID    Native stdio MCP gateway
moguri mcp tools SERVER [QUERY]    Bounded tool discovery
moguri mcp auth SERVER             Credential status (never token values)
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
      output({ protocolVersion: snapshot.protocolVersion, profileId: snapshot.profileId, projects: snapshot.projects, sessions: snapshot.sessions.map(({ id, projectId, title, status }) => ({ id, projectId, title, status })) });
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
      if (action === "inspect") output(await sdk.cache.inspect(args[0], manager));
      else {
        if (!args[2] || !values["accept-dependency-metadata"]) throw new Error("Review the exact plan, then pass its SHA-256 and --accept-dependency-metadata to authorize OSV name/version disclosure. Scripts stay blocked.");
        const job = action === "prepare" ? await sdk.cache.prepare(args[0], manager, args[2], true) :
          action === "install" ? await sdk.cache.install(args[0], manager, args[2], true, values["run-scripts"] ?? false) : null;
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
      if (action === "index") output(await sdk.memory.index(projectId));
      else if (action === "search") output(await sdk.memory.search(projectId, args.slice(1).join(" ")));
      else if (action === "graph") output(await sdk.memory.graph(projectId, args[1] ?? ""));
      else throw new Error("Use memory index, search or graph.");
    } else if (group === "skills" || group === "plugins") {
      if (action !== "import" || !args[0] || !args[1]) throw new Error("Use import PROJECT_ID FILE. Imported capabilities start disabled.");
      output(group === "skills" ? await sdk.capabilities.importSkill(args[0], args[1]) : await sdk.capabilities.importPlugin(args[0], args[1]));
    } else if (group === "mcp") {
      if (!action) {
        if (!values.session) throw new Error("Bind the gateway to --session SESSION_ID. It cannot approve itself.");
        await serveGatewayMcp(sdk, values.session); keep = true;
      } else if (action === "tools") output(await sdk.mcp.tools(args[0] ?? "builtin", args.slice(1).join(" "), 0, values.session));
      else if (action === "auth" && args[0]) output(await sdk.mcp.auth(args[0]));
      else if (action === "token" && args[0]) {
        output(await sdk.mcp.setToken(args[0], await credential()));
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
