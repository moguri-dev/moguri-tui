import type { OwnedRoleInput } from "../../apps/service/src/owned-roles.ts";
import { ownedSequenceFixture } from "./owned-sequence-api.ts";

export const contractedRouterReason = "GENERATED_ROUTER_REASON_EXCLUDED_FROM_ROLE_CONTEXT";
export async function roleContractFixture() {
  const f = await ownedSequenceFixture({ maxOutputTokens: 512 });
  const plan = { pattern: "critique", draftId: f.modelId, criticId: f.modelId, confidence: 0.95, reason: contractedRouterReason };
  const critique = { verdict: "revise", reason: "Generated contract fixture only; not independent model quality.", issues: ["Generated bounded change."] };
  const replies = [JSON.stringify(plan), JSON.stringify(f.patch), JSON.stringify(critique), JSON.stringify(f.patch)];
  const original = f.provider.prepare.bind(f.provider); let preparations = 0;
  f.provider.prepare = async (id, signal) => {
    f.providerOptions.replyText = replies[preparations++] ?? "Unexpected generated preparation.";
    return original(id, signal);
  };
  const input: OwnedRoleInput = { ...f.input, roles: [
    { role: "router", modelId: f.modelId, instruction: "Return the exact generated bound plan.", outputBound: 256, contextRoleIndices: [],
      contract: { kind: "router", pattern: "critique", draftId: f.modelId, criticId: f.modelId, minimumConfidence: 0.9 } },
    { role: "draft", modelId: f.modelId, instruction: "Return a generated unaccepted canonical patch.", outputBound: 256, contextRoleIndices: [], contract: { kind: "patch" } },
    { role: "critic", modelId: f.modelId, instruction: "Return generated bounded advice; this does not claim independent family or quality.", outputBound: 256, contextRoleIndices: [1],
      contract: { kind: "critic", candidateIndex: 1 } },
    { role: "revision", modelId: f.modelId, instruction: "Return one generated canonical unaccepted patch.", outputBound: 256, contextRoleIndices: [1, 2], contract: { kind: "patch" } },
  ] };
  return { ...f, input, replies, preparations: () => preparations, plan, critique,
    run: () => f.start(input), close: async () => { f.provider.prepare = original; await f.close(); } };
}
