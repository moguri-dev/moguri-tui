import { createServer, type ServerResponse } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { githubCopilotProvider } from "@earendil-works/pi-ai/providers/github-copilot";
import type { PreparedModel, ProviderAdapter } from "../apps/service/src/provider.ts";
import { startService } from "../apps/service/src/server.ts";
import { envelope } from "../apps/service/src/controller.ts";
import { isRecord, type ProviderState, type Session } from "../packages/protocol/src/index.ts";
import type { TaskProgressInput } from "../packages/protocol/src/progress.ts";
import type { PlatformOptions } from "../apps/service/src/platform.ts";
import type { GithubAction, LinearWorkflowInput } from "../packages/protocol/src/index.ts";
import { supportedThinking } from "../apps/service/src/model-controls.ts";
import { legacyCandidateJournal } from "./fixtures/legacy-candidate-journal.ts";
export const GENERATED_RETENTION_KEY = Buffer.alloc(32, 0x67);

export async function waitFor<T>(read: () => T | null | undefined | false, timeout = 8000): Promise<NonNullable<T>> {
  const deadline = Date.now() + timeout;
  do {
    const value = read();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 15));
  } while (Date.now() < deadline);
  throw new Error("Generated fixture condition did not settle before the deadline.");
}
export interface GeneratedProviderOptions {
  respond?: (request: Record<string, unknown>, index: number) => { text?: string; tool?: { name: string; args: Record<string, unknown> }; hold?: boolean };
  issueCreation?: { service: "github"; input: Extract<GithubAction, { kind: "github.issue.create" }> } | { service: "linear"; input: Extract<LinearWorkflowInput, { action: "issue.create" }> };
  stateSql?: boolean;
  stateSqlStatements?: { sql: string; parameters?: (string | number | boolean | null)[] }[];
  coordinationChildId?: string;
  reasoning?: boolean; exposeModels?: boolean; imageInput?: boolean; omitUsage?: boolean; maxOutputTokens?: number;
  reasoningText?: string;
  toolCall?: { name: string; args: Record<string, unknown> };
  agentTerminalRead?: boolean;
  contextWindow?: number; supportedContextWindows?: number[];
  readPaste?: { offset?: number; limit?: number; search?: string };
  documentTool?: { name: "read_document" | "search_document"; arguments: Record<string, unknown> };
  toolInput?: boolean;
  taskProgress?: TaskProgressInput; progressDelayMs?: number;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number; prompt_tokens_details?: { cached_tokens: number } };
  questionRecommendation?: { choiceIndex: number; reason: string }; questionChoices?: string[]; toolAdvice?: string; replyText?: string; holdAfterTool?: boolean; responseMode?: "text" | "auto"; redirectTo?: string;
  finishReason?: "stop" | "length";
  stream?: { chunks: string[]; delayMs: number };
  mcpCall?: { serverId: string; tool: string; arguments: Record<string, unknown>; schemaDigest: string };
}
export async function fixtureProvider(options: GeneratedProviderOptions = {}) {
  const base = githubCopilotProvider().getModels().find((model) => model.api === "openai-completions")!;
  const requests: Record<string, unknown>[] = [];
  const held = new Set<ServerResponse>();
  const headers: (string | undefined)[] = [];
  const server = createServer((request, response) => {
    void (async () => {
      if (request.method === "GET" && options.exposeModels && request.url?.endsWith("/models")) { response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ data: [{ id: base.id }] })); return; }
      const chunks = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (!isRecord(body) || !Array.isArray(body.messages)) throw new Error("Invalid generated provider request.");
      requests.push(body);
      headers.push(request.headers.authorization);
      if (options.redirectTo) { response.writeHead(307, { Location: options.redirectTo }).end(); return; }
      const messages = body.messages.filter(isRecord);
      const userIndex = messages.findLastIndex((message) => message.role === "user");
      const prompt = String(messages[userIndex]?.content ?? "");
      const toolMessages = messages.slice(userIndex + 1).filter((message) => message.role === "tool");
      if (prompt.includes("generated provider failure")) { response.writeHead(401, { "Content-Type": "application/json" }).end(JSON.stringify({ error: { message: "Generated unavailable provider", type: "authentication_error" } })); return; }
      response.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
      const chunk = (delta: unknown, finish_reason: string | null = null) => response.write(`data: ${JSON.stringify({
        id: "generated-response", object: "chat.completion.chunk", model: base.id,
        choices: [{ index: 0, delta, finish_reason }],
      })}\n\n`);
      const finish = (tool?: { name: string; args: Record<string, unknown> }, text = options.replyText ?? "Generated Copilot response. The requested fixture operation is complete.") => {
        if (tool) { if (options.toolAdvice) chunk({ role: "assistant", content: options.toolAdvice }); chunk({ role: "assistant", tool_calls: [{ index: 0, id: `generated-call-${requests.length}`, type: "function", function: { name: tool.name, arguments: JSON.stringify(tool.args) } }] }); }
        else {
          if (options.reasoningText) chunk({ role: "assistant", reasoning_content: options.reasoningText });
          chunk({ role: "assistant", content: text });
        }
        chunk({}, options.finishReason ?? (tool ? "tool_calls" : "stop"));
        if (!options.omitUsage) response.write(`data: ${JSON.stringify({ choices: [], usage: options.usage ?? { prompt_tokens: 30, completion_tokens: 12, total_tokens: 42 } })}\n\n`);
        response.end("data: [DONE]\n\n");
      };
      if (options.respond) {
        const result = options.respond(body, requests.length);
        if (result.hold) { chunk({ role: "assistant", content: result.text ?? "Generated owned request held." }); held.add(response); response.on("close", () => held.delete(response)); }
        else finish(result.tool, result.text);
      } else if (options.stream) {
        for (const text of options.stream.chunks) {
          if (response.destroyed) return;
          chunk({ role: "assistant", content: text });
          await new Promise((resolve) => setTimeout(resolve, options.stream!.delayMs));
        }
        if (!response.destroyed) finish(undefined, "");
      } else if (prompt.includes("generated slow") || options.holdAfterTool && messages.some((message) => message.role === "tool")) {
        chunk({ role: "assistant", content: "Generated work in progress." });
        held.add(response);
        response.on("close", () => held.delete(response));
      } else       if (options.coordinationChildId && messages.some((message) => message.role === "user" && String(message.content).includes("generated coordinate parent"))) {
        const count = messages.filter((message) => message.role === "tool").length;
        if (!count) finish({ name: "session_control", args: { action: "dispatch", targetSessionId: options.coordinationChildId, text: "Generated delegated child result." } });
        else if (count === 1) finish({ name: "wait_session", args: { targetSessionId: options.coordinationChildId, timeoutMs: 5000 } });
        else finish(undefined, "Generated coordinated parent result.");
      } else if (options.issueCreation && toolMessages.length < 2) {
        if (!toolMessages.length) finish({ name: "create_issue", args: { ...options.issueCreation, action: "preview" } });
        else {
          const review: unknown = JSON.parse(String(toolMessages[0]!.content));
          if (!isRecord(review) || typeof review.digest !== "string") throw new Error("Generated issue fixture requires an actual successful preview digest.");
          finish({ name: "create_issue", args: { ...options.issueCreation, action: "create", expectedDigest: review.digest,
            ...(options.issueCreation.service === "github" ? { confirmations: review.confirmations } : {}) } });
        }
      } else if (options.stateSql && prompt.includes("generated state sql") && toolMessages.length === 0) {
        finish({ name: "query_state", args: { sql: "SELECT * FROM todos" } });
      } else if (options.stateSql && prompt.includes("generated state sql") && toolMessages.length === 1) {
        const source = JSON.parse(String(toolMessages[0]!.content));
        finish({ name: "mutate_state", args: { expectedDigest: source.sourceDigest, planTitle: "Generated SQL task plan", statements: options.stateSqlStatements ?? [
          { sql: "INSERT INTO todos(id,text,status) VALUES (1,'Generated first step','done'),(2,'Generated second step','pending')" },
          { sql: "INSERT INTO memories(id,title,text) VALUES ('generated-note','Generated note','Generated retained observation.')" },
        ] } });
      } else if (options.toolCall && toolMessages.length === 0) {
        finish(options.toolCall);
      } else if (options.agentTerminalRead && toolMessages.length === 1) {
        finish({ name: "read_agent_terminal", args: { action: "list" } });
      } else if (options.agentTerminalRead && toolMessages.length === 2) {
        const listed: unknown = JSON.parse(String(toolMessages.at(-1)!.content));
        const first = isRecord(listed) && Array.isArray(listed.commands) ? listed.commands[0] : null;
        if (!isRecord(first) || typeof first.id !== "string") throw new Error("Generated agent command list has no exact command ID.");
        finish({ name: "read_agent_terminal", args: { action: "read", commandId: first.id } });
      } else if (options.documentTool && /"attachmentId":"[^"]+"/.test(prompt) && toolMessages.length === 0) {
        finish({ name: options.documentTool.name, args: { attachmentId: prompt.match(/"attachmentId":"([^"]+)"/)![1]!, ...options.documentTool.arguments } });
      } else if (options.taskProgress && prompt.includes("generated task progress") && toolMessages.length === 0) {
        if (options.progressDelayMs) await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, options.progressDelayMs);
          response.once("close", () => { clearTimeout(timer); resolve(); });
        });
        if (!response.destroyed) finish({ name: "task_progress", args: { ...options.taskProgress } });
      } else if (options.readPaste && /moguri-attachment\/[a-f0-9-]+\.txt/.test(prompt) && toolMessages.length === 0) {
        finish({ name: "read_file", args: { path: prompt.match(/moguri-attachment\/[a-f0-9-]+\.txt/)![0], ...options.readPaste } });
      } else if (options.responseMode === "text" && !prompt.includes("generated delayed")) {
        finish();
      } else if (prompt.includes("generated structured question") && toolMessages.length === 0) {
        finish({ name: "ask_user", args: { question: "Choose a generated fixture approach?", choices: options.questionChoices ?? ["Generated first choice", "Generated second choice"], allowFreeform: !prompt.includes("choices only"), ...(options.questionRecommendation ? { recommendation: options.questionRecommendation } : {}) } });
      } else if (prompt.includes("generated delayed")) {
        const timer = setTimeout(() => finish(), 600);
        response.on("close", () => clearTimeout(timer));
      } else if (prompt.includes("generated repo config proposal") && toolMessages.length === 0) {
        finish({ name: "moguri_config", args: { action: "propose", proposal: { target: "repo-instructions", section: "AGENTS.md", value: "Generated cancelled instruction advice.", reason: "Generated source-lookup cancellation." } } });
      } else if (prompt.includes("generated config proposal") && toolMessages.length === 0) {
        finish({ name: "moguri_config", args: { action: "propose", proposal: { target: "global", section: "instructions", value: "Use generated headless checks instead of opening a browser.", reason: "Generated model advice for explicit review." } } });
      } else if (prompt.includes("generated config read") && toolMessages.length === 0) {
        finish({ name: "moguri_config", args: { action: "read", target: "global", section: "notifications" } });
      } else if (prompt.includes("generated config apply") && toolMessages.length === 0) {
        finish({ name: "moguri_config", args: { action: "apply", target: "global", section: "instructions", value: "Generated unauthorized setting." } });
      } else if (prompt.includes("generated echo credential")) {
        finish(undefined, `Generated untrusted echo ${request.headers.authorization?.replace(/^Bearer /i, "") ?? "none"}`);
      } else if (prompt.includes("generated question")) {
        finish(undefined, "Which generated option would you prefer?");
      } else if (prompt.includes("generated memory search") && toolMessages.length === 0) {
        finish({ name: "memory_search", args: { query: "generated remote knowledge" } });
      } else if (prompt.includes("generated mcp call") && options.mcpCall && toolMessages.length === 0) {
        finish({ name: "mcp_gateway", args: { action: "call", ...options.mcpCall } });
      } else if (prompt.includes("generated failing command") && toolMessages.length === 0) {
        finish({ name: "run_command", args: { command: "printf 'Generated command failure\\n' >&2; exit 7", timeoutMs: 2000 } });
      } else if (prompt.includes("generated command") && toolMessages.length === 0) {
        finish({ name: "run_command", args: { command: "sleep 30 & printf 'GENERATED_CHILD=%s\\n' \"$!\"; wait", timeoutMs: 30_000 } });
      } else if (prompt.includes("generated forbidden write") && toolMessages.length === 0) {
        finish({ name: "write_file", args: { path: "forbidden.txt", text: "generated forbidden mutation", expectedDigest: "absent" } });
      } else if (prompt.includes("generated write") && toolMessages.length === 1) {
        const text = String(toolMessages[0]!.content);
        const file: unknown = text.startsWith("{") ? JSON.parse(text) : null;
        if (isRecord(file) && typeof file.digest === "string") finish({ name: "write_file", args: { path: "fixture.txt", text: "generated replacement\n", expectedDigest: file.digest } });
        else finish();
      } else if (prompt.includes("generated propose skill") && toolMessages.length === 0) {
        finish({ name: "propose_skill", args: { name: "generated-style", content: "---\nname: generated-style\ndescription: Generated style guidance\n---\nPrefer small typed functions.\n" } });
      } else if ((prompt.includes("generated tool") || prompt.includes("generated write")) && toolMessages.length === 0) {
        finish({ name: "read_file", args: { path: "fixture.txt" } });
      } else finish();
    })().catch(() => { if (!response.headersSent) response.writeHead(500); response.end("Generated provider fixture failed."); });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Fixture bind failed.");
  const model = { ...base, ...(options.contextWindow ? { contextWindow: options.contextWindow } : {}), ...(options.supportedContextWindows ? { supportedContextWindows: options.supportedContextWindows } : {}), ...(options.maxOutputTokens ? { maxTokens: options.maxOutputTokens } : {}), ...(options.imageInput ? { input: ["text", "image"] as ("text" | "image")[] } : {}), ...(options.reasoning ? { reasoning: true, compat: { ...base.compat, supportsReasoningEffort: true } } : {}), name: "Generated Copilot model", baseUrl: `http://127.0.0.1:${address.port}` };
  const catalog = [{ id: model.id, name: model.name, contextWindow: model.contextWindow, ...(model.supportedContextWindows ? { supportedContextWindows: model.supportedContextWindows } : {}), maxTokens: model.maxTokens, imageInput: options.imageInput ?? false, ...(options.toolInput !== undefined ? { toolInput: options.toolInput } : {}), thinkingLevels: supportedThinking(model) }];
  class FixtureProvider implements ProviderAdapter {
    state: ProviderState = { status: "connected", models: catalog, login: null, diagnostic: null };
    onChange = () => {};
    async refresh() { this.onChange(); }
    login() {
      this.state = { status: "connecting", models: [], login: { code: "TEST-0000", url: "https://github.com/login/device", expiresAt: Date.now() + 60_000 }, diagnostic: null };
      this.onChange();
    }
    authorize() { this.state = { status: "connected", models: catalog, login: null, diagnostic: null }; this.onChange(); }
    async cancel() { if (this.state.status === "connecting") { this.state = { status: "disconnected", models: [], login: null, diagnostic: "Generated sign-in cancelled." }; this.onChange(); } }
    async logout() { this.state = { status: "disconnected", models: [], login: null, diagnostic: null }; this.onChange(); }
    async prepare(modelId: string, signal: AbortSignal): Promise<PreparedModel> {
      signal.throwIfAborted();
      if (modelId !== model.id || this.state.status !== "connected") throw new Error("Generated model unavailable.");
      return { model, auth: { apiKey: "generated-test-only", baseUrl: model.baseUrl } };
    }
  }
  return {
    provider: new FixtureProvider(), modelId: model.id, requests, headers, baseUrl: model.baseUrl, contextWindow: model.contextWindow,
    close: async () => {
      for (const response of held) response.destroy();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
export async function setupFixture(options: GeneratedProviderOptions & { workerPath?: string; platform?: PlatformOptions; legacyCandidateJournal?: boolean } = {}) {
  const directory = await mkdtemp(join(tmpdir(), "moguri-generated-"));
  const project = join(directory, "project");
  const { mkdir } = await import("node:fs/promises");
  await mkdir(project);
  await writeFile(join(project, "fixture.txt"), "generated original\n");
  const fixture = await fixtureProvider(options);
  const terminalSecrets = new Map<string, string>();
  const terminalSlot = (id: string) => { if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,100}$/.test(id)) throw new Error("Generated terminal credential must fit the explicit production secret-backend namespace."); return id; };
  const terminalVault = { read: async (id: string) => terminalSecrets.get(terminalSlot(id)) ?? null, write: async (id: string, value: string) => { terminalSecrets.set(terminalSlot(id), value); }, remove: async (id: string) => { terminalSecrets.delete(terminalSlot(id)); } };
  const program = options.platform?.terminal?.executable ? {} : { executable: process.execPath,
    args: ["-e", "process.stdin.resume();process.stdout.write('GENERATED_TERMINAL_READY\\n');"] };
  const platform = { ...options.platform, terminal: { ...program, ...options.platform?.terminal, vault: options.platform?.terminal?.vault ?? terminalVault } };
  const service = await startService({ stateDir: join(directory, "state"), provider: fixture.provider, workerPath: options.workerPath, platform, retentionKey: GENERATED_RETENTION_KEY });
  const restoreJournal = options.legacyCandidateJournal ? legacyCandidateJournal(service.store) : () => {};
  const projectResult = await service.controller.dispatch(envelope({ type: "project.add", path: project }));
  const sessionResult = await service.controller.dispatch(envelope({ type: "session.create", projectId: projectResult.id! }));
  const sessionId = sessionResult.id!;
  const session = () => {
    const value = service.controller.snapshot().sessions.find((session) => session.id === sessionId)!;
    if (!value?.projectId) throw new Error("The generated bound fixture session is missing.");
    return { ...value, projectId: value.projectId };
  };
  const configure = async () => service.controller.dispatch(envelope({
    type: "session.configure", sessionId, expectedRevision: session().revision, controls: { ...session().controls, modelId: fixture.modelId },
  }));
  const send = async (text: string, delivery: "queue" | "steer" | "interrupt" = "queue") => {
    await service.controller.dispatch(envelope({ type: "draft.save", sessionId, expectedRevision: session().draft.revision, text, attachments: session().draft.attachments }));
    return service.controller.dispatch(envelope({ type: "message.send", sessionId, expectedRevision: session().draft.revision, delivery }));
  };
  return {
    ...fixture, directory, project, service, sessionId, session, configure, send, retentionKey: GENERATED_RETENTION_KEY, terminalVault: platform.terminal.vault,
    approve: async (allow = true) => {
      const approval = await waitFor(() => session().pendingApproval);
      return service.controller.dispatch(envelope({ type: "approval.respond", sessionId, approvalId: approval.id, allow }));
    },
    terminal: async () => waitFor<Session>(() => { const current = session(); return !current.turnId && ["completed", "stopped", "partial", "failed"].includes(current.status) ? current : false; }),
    close: async () => { await service.close(); restoreJournal(); await fixture.close(); await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); },
  };
}
