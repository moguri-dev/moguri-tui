import { writeFile } from "node:fs/promises";

const calls = [];
let respond;
globalThis.fetch = async (input, options) => {
  const request = new Request(input, options), model = globalThis.MOGURI_GENERATED_NATIVE_MODEL, base = globalThis.MOGURI_GENERATED_NATIVE_BASE;
  const solver = "generated-routed-solver-api";
  if (request.url === `${base}/models` && request.method === "GET") return Response.json({ data: [{ id: model }, { id: solver }] });
  if (request.url !== `${base}/chat/completions` || request.method !== "POST" ||
    request.headers.get("authorization") !== "Bearer generated-test-only") throw Error("Generated milestone fixture denies foreign network/credentials.");
  const body = await request.json();
  if (![model, solver].includes(body.model)) throw Error("Generated native milestone model changed.");
  if (!respond) {
    const text = body.messages.map((message) => typeof message.content === "string" ? message.content : JSON.stringify(message.content)).join("\n");
    const cell = text.match(/Sandbox\/(fixed|automatic-single|single|cascade|critique)\/(Manual|Guided|Autopilot Max|Autopilot)\//);
    if (!cell) throw Error("Generated native milestone omitted its original cell.");
    respond = globalThis.MOGURI_GENERATED_MILESTONE_RESPONDER({ selection: cell[1], autonomy: cell[2], solverId: solver,
      documentId: text.match(/attachmentId\\?"\s*:\s*\\?"([^"\\]+)/)?.[1], question: text.includes("Generated actual-question case.") });
  }
  calls.push({ modelId: body.model, request: body });
  await writeFile("/workspace/generated-native-matrix.json", JSON.stringify({
    pid: process.pid, platform: process.platform, uid: process.getuid(), runId: process.env.MOGURI_TURN_ID, calls,
  }), { mode: 0o600 });
  const result = respond(body), tool = result.tool;
  const chunk = (delta, finish_reason = null) => `data: ${JSON.stringify({ id: `generated-${calls.length}`, object: "chat.completion.chunk", model: body.model,
    choices: [{ index: 0, delta, finish_reason }] })}\n\n`;
  const delta = tool ? { role: "assistant", tool_calls: [{ index: 0, id: `generated-matrix-${calls.length}`, type: "function",
    function: { name: tool.name, arguments: JSON.stringify(tool.args) } }] } : { role: "assistant", content: result.text };
  return new Response(chunk(delta) + chunk({}, tool ? "tool_calls" : "stop") +
    `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 30, completion_tokens: 12, total_tokens: 42 } })}\n\ndata: [DONE]\n\n`,
    { headers: { "Content-Type": "text/event-stream" } });
};
