import { readFile, writeFile } from "node:fs/promises";
const path = "/workspace/generated-native-retry.json";
let calls = [];
try { calls = JSON.parse(await readFile(path, "utf8")).calls; }
catch (error) { if (error.code !== "ENOENT") throw error; }
globalThis.fetch = async (input, options) => {
  const request = new Request(input, options), model = globalThis.MOGURI_GENERATED_NATIVE_MODEL, base = globalThis.MOGURI_GENERATED_NATIVE_BASE;
  if (request.url === `${base}/models` && request.method === "GET") return Response.json({ data: [{ id: model }] });
  if (request.url !== `${base}/chat/completions` || request.method !== "POST") throw new Error("Generated native retry denies actual network.");
  const body = JSON.parse(await request.text());
  if (body.model !== model || request.headers.get("authorization") !== `Bearer ${"generated-test-only"}`) throw new Error("Generated native retry identity changed.");
  calls.push({ request: body, pid: process.pid });
  await writeFile(path, JSON.stringify({ calls }), { mode: 0o600 });
  if (calls.length === 1) return Response.json({ error: { message: "408 Generated native upstream outage." } }, { status: 408 });
  const chunk = (delta, finish_reason = null) => `data: ${JSON.stringify({ model, choices: [{ index: 0, delta, finish_reason }] })}\n\n`;
  return new Response(chunk({ role: "assistant", content: "Generated original native request recovered." }) + chunk({}, "stop") +
    `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 30, completion_tokens: 12, total_tokens: 42 } })}\n\ndata: [DONE]\n\n`,
    { headers: { "Content-Type": "text/event-stream" } });
};
