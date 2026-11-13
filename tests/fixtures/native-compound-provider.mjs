import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";

const calls = [];
globalThis.fetch = async (input, options) => {
  const request = new Request(input, options), model = globalThis.MOGURI_GENERATED_NATIVE_MODEL, base = globalThis.MOGURI_GENERATED_NATIVE_BASE;
  const solver = "generated-routed-solver-api";
  if (request.url === `${base}/models` && request.method === "GET") return Response.json({ data: [{ id: model }, { id: solver }] });
  if (request.url !== `${base}/chat/completions` || request.method !== "POST" ||
    request.headers.get("authorization") !== "Bearer generated-test-only") throw Error("Generated compound fixture denies foreign network/credentials.");
  const body = await request.json(), system = body.messages.find((message) => message.role === "system")?.content;
  if (![model, solver].includes(body.model) || typeof system !== "string" || body.tools?.length) throw Error("Generated native compound changed its exact tool-less model request.");
  let result;
  if (system.includes("Choose exactly one of the supplied eligible declared compound routes")) {
    const data = JSON.parse(body.messages.findLast((message) => message.role === "user").content), routes = data.eligibleRoutes;
    if (!Array.isArray(routes) || routes.length !== 1) throw Error("Generated native compound requires one explicit route.");
    const route = routes[0];
    result = { routeId: route.id, pattern: route.pattern, draftId: route.draftId,
      ...(route.pattern === "cascade" ? { escalationId: route.escalationId } : { criticId: route.criticId }),
      confidence: 0.95, reason: "GENERATED_NATIVE_ROUTER_REASON_NOT_CONTEXT" };
  } else if (system.includes("Critique this current request's plan, architecture and implementation")) {
    const pass = { verdict: "pass", reason: "Generated bounded observation, not acceptance or quality proof.", issues: [] };
    result = { verdict: "pass", plan: pass, architecture: pass, implementation: pass };
  } else if (system.includes("Produce exactly one bounded JSON proposal")) {
    result = { plan: "Change only the reviewed fixture.", architecture: "Keep source unchanged until separate acceptance.",
      patch: { kind: "patch", summary: "Generated native candidate.", edits: [{ path: "fixture.txt",
        baseDigest: createHash("sha256").update("generated original\n").digest("hex"), text: "Generated passing native candidate.\n" }] } };
  } else throw Error("Generated native compound received an unsupported actual role.");
  calls.push({ modelId: body.model, request: body });
  await mkdir("/workspace/.moguri", { recursive: true, mode: 0o700 });
  await writeFile("/workspace/.moguri/generated-native-compound.json", JSON.stringify({
    pid: process.pid, platform: process.platform, uid: process.getuid(), runId: process.env.MOGURI_TURN_ID, calls,
  }), { mode: 0o600 });
  const chunk = (delta, finish_reason = null) => `data: ${JSON.stringify({ id: `generated-${calls.length}`, object: "chat.completion.chunk", model: body.model,
    choices: [{ index: 0, delta, finish_reason }] })}\n\n`;
  return new Response(chunk({ role: "assistant", content: JSON.stringify(result) }) + chunk({}, "stop") +
    `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 30, completion_tokens: 12, total_tokens: 42 } })}\n\ndata: [DONE]\n\n`,
    { headers: { "Content-Type": "text/event-stream" } });
};
