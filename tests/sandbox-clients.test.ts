import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";
import { nativePublicationFixture } from "./fixtures/native-publication.ts";

test("shared CLI/TUI/desktop native commands require exact review and retain actual user publication without model or root substitution", async () => {
  const fixture = await nativePublicationFixture(), sdk = fixture.sdk;
  const execute = (args: string[]) => promisify(execFile)(process.execPath, ["--import", "tsx", resolve("apps/cli/src/main.ts"), "sandbox", ...args],
    { env: { ...process.env, MOGURI_STATE_DIR: join(fixture.directory, "state") } });
  try {
    assert.deepEqual(await sdk.slash(fixture.sessionId, "/sandbox", "desktop"), { kind: "panel", panel: "Sandbox" });
    const status = await sdk.slash(fixture.sessionId, "/sandbox status", "tui");
    assert.ok(status.kind === "text"); assert.equal(JSON.parse(status.text).sandbox.ready, false);
    await assert.rejects(() => sdk.slash(fixture.sessionId, "/sandbox probe", "tui"), /confirm-native/);
    await assert.rejects(() => execute(["probe"]), /confirm-review/);
    await assert.rejects(() => sdk.slash(fixture.sessionId, '/sandbox prepare {"paths":[]} confirm-stage', "tui"));
    await assert.rejects(() => sdk.slash(fixture.sessionId, '/sandbox prepare {"sessionId":"generated-forged","paths":[]} confirm-stage', "tui"), /actor|root|client input/);
    assert.equal(JSON.parse((await execute(["status"])).stdout).sandbox.ready, false);
    assert.equal(JSON.parse((await execute(["execution", fixture.execution.id])).stdout).execution.id, fixture.execution.id);
    const paths = join(fixture.directory, "generated-native-paths.json"); await writeFile(paths, '["fixture.txt"]');
    const review = JSON.parse((await execute(["publish-preview", fixture.execution.id, paths])).stdout).preview;
    await assert.rejects(() => execute(["publish", fixture.execution.id, paths, "--digest", review.digest, "--revision", "0"]), /confirm-write/);
    const shared = await sdk.slash(fixture.sessionId, `/sandbox publish-preview ${fixture.execution.id} ["fixture.txt"]`, "tui");
    assert.ok(shared.kind === "text");
    const preview: { confirmCommand: string } = JSON.parse(shared.text);
    const published = await sdk.slash(fixture.sessionId, preview.confirmCommand, "tui");
    assert.ok(published.kind === "text");
    const result = JSON.parse(published.text);
    assert.equal(result.publication.status, "completed"); assert.equal(result.publication.acceptance.actor, "user");
    assert.equal(JSON.parse((await execute(["publication", result.publication.id])).stdout).publication.id, result.publication.id);
    const empty = await sdk.slash(fixture.sessionId, `/sandbox result ${fixture.execution.id}`, "desktop");
    assert.ok(empty.kind === "text" && empty.text.includes("Generated first native output"));
    await assert.rejects(() => sdk.slash(fixture.sessionId, `/sandbox stop ${fixture.execution.id} confirm-stop`, "tui"), /no longer the active owner|later turn/);
    assert.equal(fixture.requests.length, 0);
  } finally { await fixture.close(); }
});
