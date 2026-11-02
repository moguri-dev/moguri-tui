import assert from "node:assert/strict";
import { defaultKupoSettings, KUPO_MODEL_ID, MoguriSdk } from "../../packages/sdk/src/index.ts";
import { fixtureProvider, setupFixture, type GeneratedProviderOptions } from "../fixture.ts";
import { appendLegacyAutopilot } from "./legacy-state.ts";
import { routedFixture } from "./single-routing.ts";

export const generatedAdvice = (choice = "allow", confidence = 0.98) => JSON.stringify({ answers: { action: {
  type: "choice", choice, confidence, probabilities: { allow: choice === "allow" ? 0.98 : 0.01, deny: choice === "deny" ? 0.98 : 0.01, askUser: choice === "askUser" ? 0.98 : 0.01 },
} } });
export const generatedTechnicalAdvice = () => JSON.stringify({ answers: { action: { type: "choice", choice: "option1", confidence: 0.98,
  probabilities: { option0: 0.01, option1: 0.98, askUser: 0.01 } } } });
export async function setupRemoteDecisions(kupo = false) {
  const fixture = await routedFixture({ env: "Remote", configured: false, legacy: false });
  try {
    const settings = structuredClone(fixture.sdk.settings.get()!.values);
    settings.decisions = { ...settings.decisions, enabled: true, provider: "bounded-model", modelId: fixture.solverId, outputTokens: 128,
      technicalQuestions: [{ id: "generated-owned-technical", kind: "technical-choice", question: "Choose a generated fixture approach?",
        choices: ["Generated first choice", "Generated second choice"] }] };
    if (kupo) settings.kupo = { ...defaultKupoSettings(), approvedModelIds: [fixture.modelId] };
    await fixture.sdk.settings.update(settings, fixture.sdk.settings.get()!.revision);
    await fixture.sdk.sessions.configure(fixture.sessionId, { ...fixture.session().controls, env: "Remote", modelId: kupo ? KUPO_MODEL_ID : fixture.modelId });
    await fixture.sdk.sessions.autonomy(fixture.sessionId, "Autopilot Max");
    fixture.options.responseMode = "auto"; fixture.solverOptions.responseMode = "text"; fixture.solverOptions.replyText = generatedTechnicalAdvice();
    return fixture;
  } catch (error) { await fixture.close(); throw error; }
}
export async function setupDecisions(options: { primary?: GeneratedProviderOptions; advice?: GeneratedProviderOptions; delegated?: boolean } = {}) {
  const f = await setupFixture(options.primary), advice = await fixtureProvider({ modelId: "generated-decision-api", responseMode: "text", exposeModels: true, replyText: generatedAdvice(), ...options.advice });
  const sdk = await new MoguriSdk(f.service.connection).ready();
  try {
    await f.configure(); await sdk.refresh();
    const settings = structuredClone(sdk.settings.get()!.values);
    if (options.delegated !== false) settings.permissions.tools.push({ id: "generated-read-delegation", tool: "read_file", decision: "allow", pathPrefix: "fixture.txt" });
    settings.localModels.push({ id: "generated-decision", name: "Generated compatible decisions", enabled: true, baseUrl: advice.baseUrl + "/v1", auth: "none",
      models: [{ id: advice.modelId, name: "Generated compatible decisions", contextWindow: 32768, maxTokens: 2048, imageInput: false }] });
    await sdk.settings.update(settings, sdk.settings.get()!.revision); await sdk.models.refresh();
    const model = sdk.getState().snapshot!.provider.models.find((model) => model.name === "Generated compatible decisions"); assert.ok(model);
    const configured = structuredClone(sdk.settings.get()!.values);
    configured.decisions = { ...configured.decisions, enabled: true, modelId: model.id, outputTokens: 256 };
    await sdk.settings.update(configured, sdk.settings.get()!.revision);
    appendLegacyAutopilot(f.service, f.sessionId, "Autopilot Max");
    await sdk.refresh();
    return { ...f, sdk, advice, decisionModelId: model.id, close: async () => { sdk.disconnect(); await f.close(); await advice.close(); } };
  } catch (error) { sdk.disconnect(); await f.close(); await advice.close(); throw error; }
}
