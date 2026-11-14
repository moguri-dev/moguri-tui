import { writeFile } from "node:fs/promises";
const calls = [];
let sourceReads = 0, prompt = "";
const save = () => writeFile("/workspace/generated-native-script-proof.json", JSON.stringify({
  platform: process.platform, uid: process.getuid(), pid: process.pid, calls, sourceReads,
}), { mode: 0o600 });
globalThis.fetch = async (input, options) => {
  const request = new Request(input, options), model = globalThis.MOGURI_GENERATED_NATIVE_MODEL, base = globalThis.MOGURI_GENERATED_NATIVE_BASE;
  if (request.url === `${base}/generated-source.sh` && request.method === "GET") {
    sourceReads++; await save();
    return new Response(prompt.includes("invalid") ? new Uint8Array([255]) : "printf GENERATED_NATIVE_URL_RUN > generated-script-result.txt\n", { headers: { "Content-Type": "text/plain" } });
  }
  if (request.url === `${base}/models` && request.method === "GET") return Response.json({ data: [{ id: model }] });
  if (request.url !== `${base}/chat/completions` || request.method !== "POST") throw new Error("Generated network denied.");
  const body = await request.json(), lastUser = body.messages.findLastIndex((message) => message.role === "user");
  prompt = JSON.stringify(body.messages[lastUser]?.content);
  if (body.model !== model || request.headers.get("authorization") !== "Bearer generated-test-only") throw new Error("Generated identity changed.");
  const tools = body.messages.slice(lastUser + 1).filter((message) => message.role === "tool"), last = tools.at(-1);
  const naming = body.messages.some((message) => ["system", "developer"].includes(message.role) && String(message.content).startsWith("Summarize the topic"));
  calls.push(model); await save();
  let operation = null, text = naming ? '{"title":"Generated script"}' : "Generated script result retained.";
  if (!naming && tools.length === 0) operation = { name: "discover_tools", arguments: { query: "review_script run_script" } };
  else if (!naming && tools.length === 1) operation = { name: "review_script", arguments: { action: "inspect",
    ...(prompt.includes("url") ? { url: `${base}/generated-source.sh` } : { path: "generated-script.sh" }), interpreter: "sh", args: [] } };
  else if (!naming && tools.length === 2) {
    let result;
    try { result = JSON.parse(last.content); } catch { result = null; }
    if (result?.complete && result.inspection) operation = { name: "review_script", arguments: { action: "review", path: result.inspection.source.path,
      id: result.inspection.id, expectedRevision: result.inspection.revision, expectedDigest: result.inspection.source.digest,
      verdict: prompt.includes("unsafe") ? "unsafe" : "safe", summary: "Generated assessment, not permission.",
      findings: prompt.includes("unsafe") ? ["Generated write needs user review."] : [] } };
    else text = "Generated source refused; no execution.";
  } else if (!naming && tools.length === 3 && (!prompt.includes("unsafe") || prompt.includes("attempt"))) {
    const result = JSON.parse(last.content);
    operation = { name: "run_script", arguments: { path: result.source.path, reviewId: result.reviewId,
      expectedDigest: result.source.digest, expectedRevision: result.revision } };
  }
  const delta = operation ? { role: "assistant", tool_calls: [{ index: 0, id: `generated-script-${calls.length}`, type: "function",
    function: { name: operation.name, arguments: JSON.stringify(operation.arguments) } }] } : { role: "assistant", content: text };
  const chunk = (delta, finish_reason = null) => `data: ${JSON.stringify({ model, choices: [{ index: 0, delta, finish_reason }] })}\n\n`;
  return new Response(chunk(delta) + chunk({}, operation ? "tool_calls" : "stop") +
    `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 30, completion_tokens: 12, total_tokens: 42 } })}\n\ndata: [DONE]\n\n`,
    { headers: { "Content-Type": "text/event-stream" } });
};
