import { writeFile } from "node:fs/promises";
const calls = [];
globalThis.fetch = async (input, options) => {
  const request = new Request(input, options), model = globalThis.MOGURI_GENERATED_NATIVE_MODEL, base = globalThis.MOGURI_GENERATED_NATIVE_BASE;
  if (request.url === `${base}/models` && request.method === "GET") return Response.json({ data: [{ id: model }] });
  if (request.url !== `${base}/chat/completions` || request.method !== "POST") throw new Error("Generated native checkpoint denies real network.");
  const body = JSON.parse(await request.text()), finishing = body.messages[0]?.content.includes("Summarize only this canonical budget-wind-down");
  if (body.model !== model || request.headers.get("authorization") !== `Bearer ${"generated-test-only"}`) throw new Error("Generated native checkpoint identity changed.");
  calls.push({ role: finishing ? "checkpoint" : "solver", pid: process.pid });
  await writeFile("/workspace/generated-native-checkpoint.json", JSON.stringify({ calls }), { mode: 0o600 });
  const tools = body.messages.filter((message) => message.role === "tool");
  const operation = finishing ? null : tools.length === 0 ? { name: "read_file", arguments: { path: "fixture.txt" } } : tools.length === 1 ?
    { name: "write_file", arguments: { path: "fixture.txt", text: "Generated separately accepted native checkpoint bytes.\n", expectedDigest: JSON.parse(tools[0].content).digest } } : null;
  const delta = operation ? { role: "assistant", tool_calls: [{ index: 0, id: `generated-${calls.length}`, type: "function",
    function: { name: operation.name, arguments: JSON.stringify(operation.arguments) } }] } :
    { role: "assistant", content: finishing ? '{"summary":"Generated native metadata, not source acceptance or Git."}' : "Generated ordinary result." };
  const chunk = (delta, finish_reason = null) => `data: ${JSON.stringify({ model, choices: [{ index: 0, delta, finish_reason }] })}\n\n`;
  return new Response(chunk(delta) + chunk({}, operation ? "tool_calls" : "stop") +
    `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 30, completion_tokens: 12, total_tokens: 42 } })}\n\ndata: [DONE]\n\n`,
    { headers: { "Content-Type": "text/event-stream" } });
};
