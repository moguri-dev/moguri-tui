import { randomUUID } from "node:crypto";
import { digest } from "@moguri-dev/sdk/testing";
import { projectRoleSequence, type RoleSequenceRecord } from "@moguri-dev/sdk/testing";
import { budgetPlanFixture } from "./budget-plan-api.ts";

export async function roleSequenceFixture() {
  const f = await budgetPlanFixture();
  try {
    const session = f.session(), roles = ["draft", "critic"] as const, authorityDigest = digest("Generated exact role authority.");
    const policy = { generatedFixtureOnly: true, models: roles.map((role) => ({ role, modelId: f.modelId, providerId: f.prepared.model.provider, apiModelId: f.prepared.model.id })) };
    const text = JSON.stringify({ format: "moguri-role-sequence-input", version: 1, task: "Generated original role task.", policy,
      scope: { projectId: session.projectId, workspaceId: session.workspaceId, env: session.controls.env } });
    const created = await f.sdk.artifacts.create(f.sessionId, { kind: "report", name: "Generated retained role sequence", text });
    const artifact = (await f.sdk.artifacts.read(created.id!)).artifact;
    const planned = f.budget.planBatch(f.session(), roles.map((role) => ({ ...f.request, id: randomUUID(), turnId: artifact.id, role, authorityDigest, inputEstimate: 100, maxOutputTokens: 64 })));
    const now = new Date().toISOString(), initial: RoleSequenceRecord = { version: 1, id: artifact.id, profileId: f.control.profileId,
      sessionId: f.sessionId, ownerSessionId: f.sessionId, ownerTurnId: artifact.id, projectId: session.projectId, workspaceId: session.workspaceId,
      folderId: planned.plans[0]!.folderId, env: session.controls.env, commandId: randomUUID(), commandDigest: digest("Generated original role command."),
      inputDigest: artifact.contentDigest, authorityDigest, policyDigest: digest(JSON.stringify(policy)), revision: 0, createdAt: now, updatedAt: now,
      stopRequested: false, status: "running", diagnostic: null, steps: planned.plans.map((plan) => ({ planId: plan.id, role: plan.role === "critic" ? "critic" : "draft",
        modelId: plan.modelId, providerId: plan.providerId, apiModelId: plan.apiModelId, inputBound: plan.inputBound, outputBound: plan.outputBound,
        state: "pending", stepId: null, inputDigest: null, resultDigest: null, outcome: null, diagnostic: null })) };
    f.append([...planned.events, f.control.platform.roles.event(initial), {
      event_type: "turn.control_started", profile_id: f.control.profileId, project_id: session.projectId, session_id: f.sessionId, turn_id: initial.id,
      payload: { purpose: "role.sequence", sequenceId: initial.id, controls: session.controls, policyRevision: f.control.snapshot().policy.revision, promptDigest: initial.inputDigest },
    }]);
    const current = () => {
      const value = f.control.snapshot().roleSequences.find((record) => record.id === initial.id);
      if (!value) throw new Error("Generated role sequence is no longer retained.");
      return value;
    };
    const start = (index: number) => {
      const old = current(), step = old.steps[index]!, stepId = randomUUID(), inputDigest = f.service.store.putBlob(JSON.stringify({ role: step.role, untrustedTask: "Generated exact per-role input." }));
      const next = structuredClone(old); Object.assign(next, { revision: old.revision + 1, updatedAt: new Date().toISOString() });
      next.steps[index] = { ...step, state: "started", stepId, inputDigest };
      const transfer = f.budget.consumePlan(f.session(), step.planId, { ...f.request, turnId: old.id, role: step.role, stepId, authorityDigest, inputEstimate: 100, maxOutputTokens: 64 });
      f.append([...transfer.events, { event_type: "model.started", profile_id: f.control.profileId, project_id: old.projectId, session_id: f.sessionId, turn_id: old.id, step_id: stepId,
        payload: { modelId: step.modelId, providerId: step.providerId ?? undefined, apiModelId: step.apiModelId, role: step.role, source: "local", contextEstimate: 100 } },
      f.control.platform.roles.event(projectRoleSequence(old, next))]);
    };
    const result = (index: number) => {
      const old = current(), step = old.steps[index]!;
      if (!step.stepId) throw new Error("Generated role must be started before its result.");
      const message = { role: "assistant", api: f.prepared.model.api, provider: f.prepared.model.provider, model: step.apiModelId, timestamp: Date.now(), stopReason: "stop",
        content: [{ type: "text", text: `GENERATED_RETAINED_${step.role.toUpperCase()}_RESULT_NOT_CONTEXT` }],
        usage: { input: 30, output: 12, totalTokens: 42, cacheRead: 0, cacheWrite: 0, cost: { input: 0, output: 0, total: 0, cacheRead: 0, cacheWrite: 0 } } };
      const resultDigest = f.service.store.putBlob(JSON.stringify(message)), next = structuredClone(old);
      Object.assign(next, { revision: old.revision + 1, updatedAt: new Date().toISOString() });
      next.steps[index] = { ...step, state: "recorded", resultDigest, outcome: "stop" };
      f.append([{ event_type: "model.completed", profile_id: f.control.profileId, project_id: old.projectId, session_id: f.sessionId, turn_id: old.id, step_id: step.stepId,
        payload: { contextDigest: resultDigest, message: { id: step.stepId, role: "assistant", turnId: old.id, text: message.content[0]!.text, timestamp: new Date(message.timestamp).toISOString() },
          usage: { stepId: step.stepId, modelId: step.modelId, providerId: step.providerId ?? undefined, apiModelId: step.apiModelId, role: step.role, source: "local",
            inputTokens: 30, outputTokens: 12, totalTokens: 42, cacheReadTokens: null, quality: "provider-reported", requestMs: 1, outcome: "stop",
            estimatedUsd: null, providerReportedUsd: null, billedUsd: null } } }, f.control.platform.roles.event(projectRoleSequence(old, next))]);
    };
    const complete = () => {
      const old = current(), next = projectRoleSequence(old, { ...old, revision: old.revision + 1, updatedAt: new Date().toISOString(), status: "completed" });
      f.append([f.control.platform.roles.event(next), { event_type: "turn.finished", profile_id: f.control.profileId, project_id: old.projectId,
        session_id: f.sessionId, turn_id: old.id, payload: { outcome: "completed", diagnostic: null, workspaceEffects: "none" } }]);
    };
    return { ...f, initial, planned, current, start, result, complete, text };
  } catch (error) { await f.close(); throw error; }
}
