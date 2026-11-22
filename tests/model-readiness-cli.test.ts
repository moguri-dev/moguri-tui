import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join, resolve } from "node:path";
import { isRecord, ModelReadinessReportSchema, ModelRuntimePreviewSchema, MoguriSdk, parse } from "@moguri-dev/sdk";
import { setupFixture } from "./fixture.ts";
import { configureGeneratedReadiness, generatedReviewedReadinessCollector } from "./fixtures/model-readiness.ts";

test("the built CLI previews, separately confirms and consumes one exact runtime review without inference or implicit model selection", {
  timeout: 20_000,
}, async () => {
  const fixture = await setupFixture({ exposeModels: true, responseMode: "text", platform: { modelReadiness: { collect: generatedReviewedReadinessCollector } } });
  const sdk = await new MoguriSdk(fixture.service.connection).ready();
  const execute = (args: string[]) => promisify(execFile)(process.execPath, [resolve("dist/cli.mjs"), "models", ...args, "--session", fixture.sessionId], {
    env: { ...process.env, MOGURI_STATE_DIR: join(fixture.directory, "state"), MOGURI_PROFILE_ID: sdk.profileId }, timeout: 10000,
  });
  try {
    const model = await configureGeneratedReadiness(sdk, fixture, { runtime: { kind: "llama-cpp", executablePath: "/generated/readiness/llama-cli" } });
    const metadata: unknown = JSON.parse((await execute(["readiness", model.id])).stdout);
    assert.ok(isRecord(metadata));
    assert.equal(parse(ModelReadinessReportSchema, metadata.readiness).observations.runtime?.version.status, "unknown");
    const previewBody: unknown = JSON.parse((await execute(["runtime-preview", model.id])).stdout);
    assert.ok(isRecord(previewBody));
    const preview = parse(ModelRuntimePreviewSchema, previewBody.preview);
    await assert.rejects(() => execute(["runtime-review", model.id, preview.digest]), /confirm-review/);
    const reviewed: unknown = JSON.parse((await execute(["runtime-review", model.id, preview.digest, "--confirm-review"])).stdout);
    assert.ok(isRecord(reviewed) && typeof reviewed.id === "string");
    const reviewId = reviewed.id;
    const reportBody: unknown = JSON.parse((await execute(["runtime-probe", model.id, reviewId])).stdout);
    assert.ok(isRecord(reportBody));
    assert.equal(parse(ModelReadinessReportSchema, reportBody.readiness).observations.runtime?.version.value, "build:9911@abcdef01234567");
    await assert.rejects(() => execute(["runtime-probe", model.id, reviewId]), /consumed|replay|already/i);
    await assert.rejects(() => execute(["readiness", model.id, "automatic"]), /readiness|required|models/i);
    assert.equal(fixture.session().controls.modelId, null);
    assert.equal(fixture.requests.length, 0);
    assert.equal(fixture.service.controller.events(0).filter((event) => event.event_type === "model.runtime_executable_reviewed").length, 1);
    assert.equal(fixture.service.controller.events(0).filter((event) => event.event_type === "model.runtime_review_consumed").length, 1);
  } finally { sdk.disconnect(); await fixture.close(); }
});
