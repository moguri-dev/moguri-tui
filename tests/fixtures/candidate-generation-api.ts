import { randomUUID } from "node:crypto";
import { digest } from "@moguri-dev/sdk/testing";
import { candidateApiFixture } from "./candidate-api.ts";

export const generatedCandidatePatch = { kind: "patch" as const, summary: "Generated model proposal", edits: [
  { path: "fixture.txt", baseDigest: digest("generated original\n"), text: "GENERATED_MODEL_PROPOSAL_NOT_CONTEXT\n" },
] };
export async function candidateGenerationFixture(reply = JSON.stringify(generatedCandidatePatch), options: Parameters<typeof candidateApiFixture>[0] = {}) {
  const f = await candidateApiFixture({ replyText: reply, responseMode: "text", maxOutputTokens: 256, ...options });
  try {
    await f.configure();
    const input = { task: "Generate a reviewed fixture improvement.", files: [{ path: "fixture.txt", baseDigest: generatedCandidatePatch.edits[0]!.baseDigest }] };
    const generate = async (value = input, commandId: string = randomUUID()) => {
      const preview = (await f.sdk.candidates.generatePreview(f.sessionId, f.workspace.id, value)).preview;
      const command = { type: "candidate.generate" as const, sessionId: f.sessionId, stageWorkspaceId: f.workspace.id, input: value, expectedDigest: preview.digest, confirmCost: true as const };
      const started = await f.sdk.command(command, commandId); return { id: started.id!, commandId, command, preview };
    };
    return { ...f, input, generate, settled: (id: string) => f.sdk.candidates.waitGeneration(id) };
  } catch (error) { await f.close(); throw error; }
}
