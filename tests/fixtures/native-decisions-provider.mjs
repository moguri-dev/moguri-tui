import { writeFile } from "node:fs/promises";

const calls = [];
globalThis.fetch = async (input, options) => {
  const request = new Request(input, options), model = globalThis.MOGURI_GENERATED_NATIVE_MODEL, base = globalThis.MOGURI_GENERATED_NATIVE_BASE;
  if (request.url === `${base}/models` && request.method === "GET") return Response.json({ data: [{ id: model }] });
  if (request.url !== `${base}/chat/completions` || request.method !== "POST") throw Error("Generated owned decision fixture denies real network access.");
  const body = JSON.parse(await request.text());
  if (body.model !== model || request.headers.get("authorization") !== "Bearer generated-test-only") throw Error("Generated model/credential binding changed.");
  const decision = body.messages[0]?.content.includes("Evaluate only the supplied state");
  const finishing = body.messages[0]?.content.includes("Summarize only this canonical budget-wind-down");
  calls.push({ role: decision ? "decision" : finishing ? "checkpoint" : "solver", model, pid: process.pid, maxOutput: body.max_tokens ?? body.max_completion_tokens,
    tools: body.tools?.map((tool) => tool.function.name) ?? [] });
  await writeFile("/workspace/generated-native-decisions.json", JSON.stringify({ calls }), { mode: 0o600 });
  const tool = !decision && !finishing && !body.messages.some((message) => message.role === "tool");
  const text = decision ? JSON.stringify({ answers: { action: { type: "choice", choice: "option1", confidence: 0.98,
    probabilities: { option0: 0.01, option1: 0.98, askUser: 0.01 } } } }) : finishing ?
      '{"summary":"Generated native source-independent checkpoint data."}' : "Generated native solver completed after its owned decision.";
  const operation = globalThis.MOGURI_GENERATED_NATIVE_SCENARIO === "finishing" ? { name: "read_file", arguments: { path: "fixture.txt" } } :
    { name: "ask_user", arguments: { question: "Choose a generated fixture approach?", choices: ["Generated first choice", "Generated second choice"], allowFreeform: false } };
  const delta = tool ? { role: "assistant", tool_calls: [{ index: 0, id: `generated-question-${calls.length}`, type: "function", function: {
    name: operation.name, arguments: JSON.stringify(operation.arguments) } }] } :
    { role: "assistant", content: text };
  const chunk = (delta, finish_reason = null) => `data: ${JSON.stringify({ id: `generated-${calls.length}`, object: "chat.completion.chunk", model,
    choices: [{ index: 0, delta, finish_reason }] })}\n\n`;
  return new Response(chunk(delta) + chunk({}, tool ? "tool_calls" : "stop") +
    `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 30, completion_tokens: 12, total_tokens: 42 } })}\n\ndata: [DONE]\n\n`,
  { headers: { "Content-Type": "text/event-stream" } });
};
