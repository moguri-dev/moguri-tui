import { createHash } from "node:crypto";
import type { KupoModelProfileInput, MoguriSdk } from "@moguri-dev/sdk";

const evaluationSet = createHash("sha256").update("Generated four-dimension routing mechanics, not real model evaluation.").digest("hex");
export async function generatedKupoProfile(sdk: MoguriSdk, modelId: string, values: {
  category?: KupoModelProfileInput["category"]; costClass?: string; score?: number; price?: number;
} = {}) {
  const model = sdk.getState().snapshot?.provider.models.find((model) => model.id === modelId);
  if (!model) throw new Error("Generated profile requires its actual advertised model.");
  const noApi = model.source === "local" && model.endpointBoundary === "loopback", score = values.score ?? 0.5, price = values.price ?? (noApi ? 0 : 1);
  const data = { modelId, category: values.category ?? "standard", costClass: values.costClass ?? "generated-peer", score, price };
  return (await sdk.routing.profileDraft({ modelId, category: data.category, costClass: data.costClass, evaluationSet,
    scores: { reasoning: score, code: score, debugging: score, tools: score }, referencePrice: { inputUsdPerMillion: price, outputUsdPerMillion: price,
      basis: noApi && price === 0 ? "local-no-api-fee" : "provider-api-equivalent" },
    sourceUrl: "https://generated-evidence.invalid/routing-mechanics", sourceText: JSON.stringify({ fixtureOnly: true, data }),
    observedAt: new Date().toISOString(), validUntil: new Date(Date.now() + 3600000).toISOString(),
    limitations: "Generated mechanical fixture only. Not real model quality, independence, live pricing or calibration evidence." })).profile;
}
