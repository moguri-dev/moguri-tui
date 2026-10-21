import { randomUUID } from "node:crypto";
import { MoguriSdk, projectEvents, type EventInput } from "../../packages/sdk/src/index.ts";
import { setupFixture } from "../fixture.ts";

export async function budgetPlanFixture() {
  const f = await setupFixture(), sdk = await new MoguriSdk(f.service.connection).ready();
  try {
    await f.configure();
    const control = f.service.controller, budget = control.platform.budgets, prepared = await f.provider.prepare(f.modelId, AbortSignal.timeout(5000));
    const turnId: string = randomUUID();
    const request = { turnId, role: "checkpoint" as const, modelId: f.modelId, providerId: prepared.model.provider, apiModelId: prepared.model.id,
      authorityDigest: "a".repeat(64), inputEstimate: 10, maxOutputTokens: 20 };
    const append = (events: EventInput[]) => {
      control.store.commit(events, undefined, undefined, (primary) => {
        const next = { ...control.snapshot(), ...projectEvents([...control.events(0), ...primary], control.profileId) };
        return budget.derived(next, primary);
      });
      control.refreshProfile();
    };
    const create = (changes: Partial<typeof request> & { id?: string } = {}) => {
      const result = budget.plan(f.session(), { ...request, id: randomUUID(), ...changes });
      append([result.event]); return result.plan;
    };
    const consume = (id: string, changes: Partial<typeof request> = {}) => {
      const input = { ...request, ...changes, stepId: randomUUID() }, result = budget.consumePlan(f.session(), id, input);
      const started: EventInput = { event_type: "model.started", profile_id: control.profileId, project_id: f.session().projectId, session_id: f.sessionId, turn_id: input.turnId, step_id: input.stepId,
        payload: { modelId: input.modelId, providerId: input.providerId, apiModelId: input.apiModelId, role: input.role, source: "local", contextEstimate: input.inputEstimate } };
      append([...result.events, started]); return { ...result, stepId: input.stepId };
    };
    return { ...f, sdk, control, budget, request, prepared, append, create, consume,
      close: async () => { sdk.disconnect(); await f.close(); } };
  } catch (error) { sdk.disconnect(); await f.close(); throw error; }
}
