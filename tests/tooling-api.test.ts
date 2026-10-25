import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { setupFixture, waitFor } from "./fixture.ts";
import { envelope } from "../apps/service/src/controller.ts";

test("the shared tooling API binds schema/source approvals without spending on a model", async () => {
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
    assert.equal(f.session().pendingApproval?.call.name, "read_file");
    await f.approve();
    await waitFor(() => f.service.controller.snapshot().jobs.find((job) => job.id === result.id)?.status === "completed");
    assert.equal(await readFile(join(f.project, "fixture.txt"), "utf8"), "generated original\n");
    assert.equal(f.requests.length, 0);
    await assert.rejects(() => f.service.controller.dispatch(envelope({ type: "tooling.execute", sessionId: f.sessionId,
      name: "read_file", schemaDigest: "0".repeat(64), arguments: { path: "fixture.txt" } })), { code: "tool_schema" });
  } finally { await f.close(); }
});
