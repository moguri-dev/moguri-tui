import { createServer, type ServerResponse } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { githubCopilotProvider } from "@earendil-works/pi-ai/providers/github-copilot";
import type { PreparedModel, ProviderAdapter } from "../apps/service/src/provider.ts";
import { startService } from "../apps/service/src/server.ts";
import { envelope } from "../apps/service/src/controller.ts";
import { isRecord, type ProviderState, type Session } from "../packages/protocol/src/index.ts";
import type { PlatformOptions } from "../apps/service/src/platform.ts";
import { supportedThinking } from "../apps/service/src/model-controls.ts";
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
export async function fixtureProvider(options: { reasoning?: boolean } = {}) {
  const base = githubCopilotProvider().getModels().find((model) => model.api === "openai-completions")!;
  const requests: Record<string, unknown>[] = [];
  const held = new Set<ServerResponse>();
  const server = createServer((request, response) => {
    void (async () => {
      const chunks = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (!isRecord(body) || !Array.isArray(body.messages)) throw new Error("Invalid generated provider request.");
      requests.push(body);
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
      const finish = (tool?: { name: string; args: Record<string, unknown> }, text = "Generated Copilot response. The requested fixture operation is complete.") => {
        if (tool) chunk({ role: "assistant", tool_calls: [{ index: 0, id: `generated-call-${requests.length}`, type: "function", function: { name: tool.name, arguments: JSON.stringify(tool.args) } }] });
        else chunk({ role: "assistant", content: text });
        chunk({}, tool ? "tool_calls" : "stop");
        response.write(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 30, completion_tokens: 12, total_tokens: 42 } })}\n\n`);
        response.end("data: [DONE]\n\n");
      };
      if (prompt.includes("generated slow")) {
        chunk({ role: "assistant", content: "Generated work in progress." });
        held.add(response);
        response.on("close", () => held.delete(response));
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
      } else if (prompt.includes("generated question")) {
        finish(undefined, "Which generated option would you prefer?");
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
  const model = { ...base, ...(options.reasoning ? { reasoning: true, compat: { ...base.compat, supportsReasoningEffort: true } } : {}), name: "Generated Copilot model", baseUrl: `http://127.0.0.1:${address.port}` };
  const catalog = [{ id: model.id, name: model.name, contextWindow: model.contextWindow, imageInput: false, thinkingLevels: supportedThinking(model) }];
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
    provider: new FixtureProvider(), modelId: model.id, requests,
    close: async () => {
      for (const response of held) response.destroy();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
export async function setupFixture(options: { workerPath?: string; platform?: PlatformOptions; reasoning?: boolean } = {}) {
  const directory = await mkdtemp(join(tmpdir(), "moguri-generated-"));
  const project = join(directory, "project");
  const { mkdir } = await import("node:fs/promises");
  await mkdir(project);
  await writeFile(join(project, "fixture.txt"), "generated original\n");
  const fixture = await fixtureProvider({ reasoning: options.reasoning });
  const service = await startService({ stateDir: join(directory, "state"), provider: fixture.provider, workerPath: options.workerPath, platform: options.platform, retentionKey: GENERATED_RETENTION_KEY });
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
    await service.controller.dispatch(envelope({ type: "draft.save", sessionId, expectedRevision: session().draft.revision, text, attachments: [] }));
    return service.controller.dispatch(envelope({ type: "message.send", sessionId, expectedRevision: session().draft.revision, delivery }));
  };
  return {
    ...fixture, directory, project, service, sessionId, session, configure, send, retentionKey: GENERATED_RETENTION_KEY,
    approve: async (allow = true) => {
      const approval = await waitFor(() => session().pendingApproval);
      return service.controller.dispatch(envelope({ type: "approval.respond", sessionId, approvalId: approval.id, allow }));
    },
    terminal: async () => waitFor<Session>(() => { const current = session(); return !current.turnId && ["completed", "stopped", "partial", "failed"].includes(current.status) ? current : false; }),
    close: async () => { await service.close(); await fixture.close(); await rm(directory, { recursive: true, force: true }); },
  };
}
