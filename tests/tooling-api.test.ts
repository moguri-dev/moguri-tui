import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { setupFixture, waitFor } from "./fixture.ts";
import { envelope } from "../apps/service/src/controller.ts";
import { MoguriSdk } from "../packages/sdk/src/index.ts";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { resolve } from "node:path";

test("the compiled CLI uses the same typed catalogue and coordination authority without inference", async () => {
  const f = await setupFixture(), sdk = await new MoguriSdk(f.service.connection).ready();
  const run = (...args: string[]) => promisify(execFile)(process.execPath, [resolve("dist/cli.mjs"), ...args, "--session", f.sessionId, "--json"],
    { env: { ...process.env, MOGURI_STATE_DIR: join(f.directory, "state") } });
  try {
    const side = await sdk.sessions.spawn(f.sessionId, "side");
    const catalogue = JSON.parse((await run("tools", "edit_file")).stdout);
    assert.ok(catalogue.tools.some((tool: { name: string }) => tool.name === "edit_file"));
    const value = JSON.parse((await run("coordinate", "read", JSON.stringify({ action: "inspect", targetSessionId: side.id }))).stdout);
    assert.equal(value.data.id, side.id); assert.equal(value.data.mode, "read-only");
    await run("firewall", "add", "session", "cli.example.invalid");
    const websites = JSON.parse((await run("firewall", "list")).stdout);
    assert.equal(websites.effective.length, 1); assert.equal(websites.effective[0].site, "cli.example.invalid");
    await run("firewall", "remove", websites.effective[0].id);
    await sdk.refresh(); assert.deepEqual(sdk.webAllowlist.list(), []);
    assert.equal(f.requests.length, 0);
  } finally { sdk.disconnect(); await f.close(); }
});

test("the shared tooling API binds native schema/source policy without spending on a model", async () => {
  const f = await setupFixture();
  try {
    const catalog = await f.service.controller.platform.query({ type: "tooling.catalog", sessionId: f.sessionId, query: "edit_file" });
    assert.equal(catalog.type, "tooling.catalog");
    if (catalog.type !== "tooling.catalog") assert.fail("Missing typed catalogue.");
    const edit = catalog.tools.find((tool) => tool.name === "edit_file");
    assert.ok(edit);
    const source = await f.service.controller.platform.query({ type: "tooling.catalog", sessionId: f.sessionId, query: "read_file" });
    if (source.type !== "tooling.catalog") assert.fail("Missing typed source catalogue.");
    const tool = source.tools.find((tool) => tool.name === "read_file")!;
    const result = await f.service.controller.dispatch(envelope({ type: "tooling.execute", sessionId: f.sessionId,
      name: tool.name, schemaDigest: tool.schemaDigest, arguments: { path: "fixture.txt" } }));
    assert.equal(f.requests.length, 0);
    assert.equal(f.session().pendingApproval, null);
    await waitFor(() => f.service.controller.snapshot().jobs.find((job) => job.id === result.id)?.status === "completed");
    assert.equal(await readFile(join(f.project, "fixture.txt"), "utf8"), "generated original\n");
    assert.equal(f.requests.length, 0);
    assert.ok(f.service.controller.events(0).some((event) => event.event_type === "tool.decided" && event.payload.actor === "policy"));
    await assert.rejects(() => f.service.controller.dispatch(envelope({ type: "tooling.execute", sessionId: f.sessionId,
      name: "read_file", schemaDigest: "0".repeat(64), arguments: { path: "fixture.txt" } })), { code: "tool_schema" });
  } finally { await f.close(); }
});

test("shared tooling and coordination slash commands do not infer, consume a draft or invent message authorship", async () => {
  const f = await setupFixture(), sdk = await new MoguriSdk(f.service.connection).ready();
  try {
    const created = await sdk.sessions.spawn(f.sessionId, "side");
    const catalog = await sdk.slash(f.sessionId, "/tools edit_file", "tui");
    assert.equal(catalog.kind, "text"); if (catalog.kind === "text") assert.match(catalog.text, /schemaDigest/);
    const read = await sdk.slash(f.sessionId, `/coordinate read ${JSON.stringify({ action: "inspect", targetSessionId: created.id })}`, "cli");
    assert.equal(read.kind, "text"); if (read.kind === "text") assert.equal(JSON.parse(read.text).data.id, created.id);
    await sdk.slash(created.id!, `/coordinate message ${f.sessionId} Generated actual user advisory.`, "tui");
    const message = f.service.controller.snapshot().coordinationMessages.at(-1)!;
    assert.equal(message.origin.actor, "user"); assert.equal(message.fromSessionId, created.id);
    assert.equal(f.requests.length, 0);
    assert.equal(f.session().draft.text, "");
    const query = await sdk.slash(f.sessionId, "/state SELECT count(*) AS count FROM todos", "cli");
    assert.equal(query.kind, "text"); if (query.kind === "text") assert.equal(JSON.parse(query.text).data.rows[0].count, 0);
  } finally { sdk.disconnect(); await f.close(); }
});
