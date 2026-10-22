import { writeFile } from "node:fs/promises";

const calls = [];
const save = () => writeFile("/workspace/generated-native-proof.json", JSON.stringify({ pid: process.pid, runId: process.env.MOGURI_TURN_ID ?? null, calls }), { mode: 0o600 });
globalThis.fetch = async (input, options) => {
  const request = new Request(input, options), model = globalThis.MOGURI_GENERATED_NATIVE_MODEL;
  if (request.url === "https://api.githubcopilot.com/models" && request.method === "GET") return Response.json({ data: [{ id: model }] });
  if (request.url !== "https://api.githubcopilot.com/chat/completions" || request.method !== "POST") throw Error("Generated native fixture denies every actual network destination.");
  const text = await request.text(), body = JSON.parse(text), prompt = JSON.stringify(body.messages), tools = body.messages.filter((message) => message.role === "tool");
  if (body.model !== model || request.headers.get("authorization") !== "Bearer generated-test-only") throw Error("Generated native model or request credential changed.");
  calls.push({ model, bytes: text.length, tail: text.includes("GENERATED_PASTE_END_NOT_SENT"), tools: body.tools?.map((tool) => tool.function.name) ?? [] });
  await save();
  const chunk = (delta, finish_reason = null) => `data: ${JSON.stringify({ id: `generated-${calls.length}`, object: "chat.completion.chunk", model,
    choices: [{ index: 0, delta, finish_reason }] })}\n\n`;
  if (prompt.includes("generated native slow")) return new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(chunk({ role: "assistant", content: "GENERATED_NATIVE_PENDING" })));
      const abort = () => controller.error(new DOMException("Generated native cancellation.", "AbortError"));
      request.signal.addEventListener("abort", abort, { once: true });
      if (request.signal.aborted) abort();
    },
  }), { headers: { "Content-Type": "text/event-stream" } });
  const paste = prompt.match(/moguri-attachment\/[a-f0-9-]+\.txt/);
  const call = tools.length === 0 && paste ? { name: "read_file", arguments: { path: paste[0], offset: 0, limit: 64 } } :
    prompt.includes("generated native write") && tools.length === 0 ? { name: "read_file", arguments: { path: "fixture.txt" } } :
    prompt.includes("generated native write") && tools.length === 1 ? { name: "write_file", arguments: { path: "fixture.txt", text: "generated native replacement\n", expectedDigest: JSON.parse(tools[0].content).digest } } : null;
  const delta = call ? { role: "assistant", tool_calls: [{ index: 0, id: `generated-native-tool-${calls.length}`, type: "function", function: { name: call.name, arguments: JSON.stringify(call.arguments) } }] } :
    { role: "assistant", content: "Generated native model completed." };
  return new Response(chunk(delta) + chunk({}, call ? "tool_calls" : "stop") +
    `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 30, completion_tokens: 12, total_tokens: 42 } })}\n\ndata: [DONE]\n\n`,
  { headers: { "Content-Type": "text/event-stream" } });
};
