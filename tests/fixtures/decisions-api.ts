import assert from "node:assert/strict";
import { MoguriSdk } from "../../packages/sdk/src/index.ts";
import { fixtureProvider, setupFixture, type GeneratedProviderOptions } from "../fixture.ts";
import { appendLegacyAutopilot } from "./legacy-state.ts";

export const generatedAdvice = (choice = "allow", confidence = 0.98) => JSON.stringify({ answers: { action: {
  type: "choice", choice, confidence, probabilities: { allow: choice === "allow" ? 0.98 : 0.01, deny: choice === "deny" ? 0.98 : 0.01, askUser: choice === "askUser" ? 0.98 : 0.01 },
} } });
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
