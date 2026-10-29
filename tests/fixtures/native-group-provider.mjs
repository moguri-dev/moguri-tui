import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";

const calls = [];
globalThis.fetch = async (input, options) => {
  const request = new Request(input, options), model = globalThis.MOGURI_GENERATED_NATIVE_MODEL, base = globalThis.MOGURI_GENERATED_NATIVE_BASE;
  if ([`${base}/models`, "https://api.githubcopilot.com/models"].includes(request.url) && request.method === "GET") return Response.json({ data: [{ id: model }] });
  if (request.url !== `${base}/chat/completions` || request.method !== "POST") throw Error("Generated group fixture denies every actual network destination.");
  const body = await request.json(), last = body.messages.findLastIndex((message) => message.role === "user"),
    ids = JSON.stringify(body.messages[last]?.content).match(/generated native group ([a-f0-9-]+) ([a-f0-9-]+)/),
    tools = body.messages.slice(last + 1).filter((message) => message.role === "tool"), count = tools.length;
  if (!ids || body.model !== model || request.headers.get("authorization") !== "******") throw Error("Generated group model, exact repositories or credential changed.");
  calls.push({ count, model, pid: process.pid, platform: process.platform, uid: process.getuid(), tools: body.tools.map((tool) => tool.function.name) });
  const directory = createHash("sha256").update(`moguri-native-repository-v1\0${ids[1]}`).digest("hex");
  await writeFile(`/workspace/repositories/${directory}/generated-native-proof.json`, JSON.stringify(calls), { mode: 0o600 });
  const index = count % 2, repository = ids[index + 1], args = count < 2 ? { repository, path: "fixture.txt" } :
    count < 4 ? { repository, path: "fixture.txt", text: `Generated native group output ${index}.\n`, expectedDigest: JSON.parse(tools[index].content).digest } :
      { repository, command: "pwd; printf 'Generated group shell\\n' > generated-shell.txt", timeoutMs: 10000 };
  const call = count < 6 ? { name: count < 2 ? "read_file" : count < 4 ? "write_file" : "run_command", arguments: args } : null;
  const chunk = (delta, finish_reason = null) => `data: ${JSON.stringify({ id: `generated-group-${calls.length}`, object: "chat.completion.chunk", model,
    choices: [{ index: 0, delta, finish_reason }] })}\n\n`;
  const delta = call ? { role: "assistant", tool_calls: [{ index: 0, id: `generated-group-tool-${calls.length}`, type: "function",
    function: { name: call.name, arguments: JSON.stringify(call.arguments) } }] } : { role: "assistant", content: "Generated two-root native model completed." };
  return new Response(chunk(delta) + chunk({}, call ? "tool_calls" : "stop") +
    `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 30, completion_tokens: 12, total_tokens: 42 } })}\n\ndata: [DONE]\n\n`,
    { headers: { "Content-Type": "text/event-stream" } });
};
