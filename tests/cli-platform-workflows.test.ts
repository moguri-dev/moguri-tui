import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { MoguriSdk } from "../packages/sdk/src/index.ts";
import { setupFixture } from "./fixture.ts";
import { initializeGeneratedRepository } from "./fixtures/git-project.ts";

test("dedicated CLI binds reviewed knowledge, disabled hooks, exact Git intent and containment policy through the installed service", async () => {
  const fixture = await setupFixture(), sdk = await new MoguriSdk(fixture.service.connection).ready();
  const git = initializeGeneratedRepository(fixture.project);
  for (const [name, value] of [["core.hooksPath", "/dev/null"], ["tag.gpgSign", "false"], ["commit.gpgSign", "false"]]) git(["config", name!, value!]);
  const execute = (args: string[]) => promisify(execFile)(process.execPath, ["--import", "tsx", resolve("apps/cli/src/main.ts"), ...args], {
    env: { ...process.env, MOGURI_STATE_DIR: join(fixture.directory, "state"), MOGURI_PROFILE_ID: sdk.profileId },
  });
  try {
    const noteFile = join(fixture.directory, "generated-note.json"), summaryFile = join(fixture.directory, "generated-summary.json"), projectId = fixture.session().projectId!;
    await writeFile(noteFile, JSON.stringify({ tier: "Terra", projectId, title: "Generated CLI Terra", text: "Generated CLI reviewed knowledge with original detail." }));
    const note = JSON.parse((await execute(["knowledge", "save", noteFile])).stdout);
    const original = await sdk.knowledge.read(note.id);
    await writeFile(summaryFile, JSON.stringify({ tier: "Glacier", title: "Generated CLI Glacier", text: "Generated CLI reviewed knowledge." }));
    const promote = ["knowledge", "promote", note.id, summaryFile, "--revision", "0", "--digest", original.record.contentDigest];
    await assert.rejects(() => execute(promote), /confirm-review/);
    const promoted = JSON.parse((await execute([...promote, "--confirm-review"])).stdout);
    await execute(["knowledge", "forget", note.id, "--revision", "0", "--confirm-remove"]);
    await assert.rejects(() => sdk.knowledge.read(note.id), { code: "knowledge_missing" });
    assert.equal((await sdk.knowledge.read(promoted.id)).text, "Generated CLI reviewed knowledge.");

    const hookFile = join(fixture.directory, "generated-hook.json");
    await writeFile(hookFile, JSON.stringify({ schemaVersion: 1, name: "generated-cli-hook", description: "Generated CLI hook", trigger: "turn.start", command: "printf generated-cli", timeoutMs: 1000 }));
    const hook = JSON.parse((await execute(["hooks", "import", hookFile, "--project", projectId, "--confirm-review"])).stdout);
    assert.equal(fixture.service.controller.snapshot().registry.find((entry) => entry.id === hook.id)?.enabled, false);
    const versions = JSON.parse((await execute(["capability", "history", hook.id])).stdout);
    assert.equal(versions.entries[0].kind, "hook");
    assert.deepEqual(JSON.parse((await execute(["cache", "registries"])).stdout).registries, []);

    const actionFile = join(fixture.directory, "generated-git-action.json"), phrasesFile = join(fixture.directory, "generated-git-confirmations.json");
    const head = git(["rev-parse", "HEAD"]), index = await readFile(join(fixture.project, ".git/index"));
    await writeFile(actionFile, JSON.stringify({ kind: "git.tag.create", tag: "generated-cli-reviewed-tag", target: head, annotated: false, message: "" }));
    const scope = ["--project", projectId, "--session", fixture.sessionId];
    const preview = JSON.parse((await execute(["github", "preview", actionFile, ...scope])).stdout).preview;
    await writeFile(phrasesFile, JSON.stringify(preview.document.confirmations));
    const dispatch = ["github", "execute", actionFile, ...scope, "--digest", preview.digest, "--confirmations", phrasesFile];
    await assert.rejects(() => execute(dispatch), /confirm-review/);
    const started = JSON.parse((await execute([...dispatch, "--confirm-review"])).stdout);
    const result = JSON.parse((await execute(["github", "wait", started.id])).stdout);
    assert.equal(result.operation.status, "completed");
    assert.equal(result.operation.originSessionId, fixture.sessionId);
    const activity = JSON.parse((await execute(["activity", "list", "--session", fixture.sessionId])).stdout).activity;
    const operation = activity.entries.find((entry: { source: string }) => entry.source === "github");
    assert.equal(operation.turnId, null); assert.equal(operation.status, "completed");
    const activityArguments = JSON.parse((await execute(["activity", "read", operation.id, "arguments", "--session", fixture.sessionId])).stdout);
    assert.equal(JSON.parse(activityArguments.content.text).kind, "git.tag.create");
    await assert.rejects(() => execute(["activity", "list"]), /session/);
    await assert.rejects(() => execute(["activity", "read", operation.id, "output", "-1", "--session", fixture.sessionId]), /offset|option/i);
    assert.equal(git(["rev-parse", "refs/tags/generated-cli-reviewed-tag"]), head);
    assert.deepEqual(await readFile(join(fixture.project, ".git/index")), index);

    await assert.rejects(() => execute(["containment", "require-sandbox"]), /confirm-review/);
    await execute(["containment", "require-sandbox", "--confirm-review"]);
    assert.equal(JSON.parse((await execute(["containment", "status"])).stdout).containment.required, true);
    assert.equal(fixture.session().controls.env, "Local");
    assert.equal(fixture.requests.length, 0);
  } finally { sdk.disconnect(); await fixture.close(); }
});
