import { digest } from "@moguri-dev/sdk/testing";
import { ownedSequenceFixture } from "./owned-sequence-api.ts";

export const roleProposalPatch = { kind: "patch" as const, summary: "Generated canonical final-role proposal.", edits: [
  { path: "fixture.txt", baseDigest: digest("generated original\n"), text: "Generated actual final-role proposed bytes.\n" },
] };
export async function roleProposalFixture(options: { legacyCandidateJournal?: boolean } = {}) {
  const f = await ownedSequenceFixture({ ...options, replyText: JSON.stringify(roleProposalPatch) });
  try {
    const created = await f.start(), sequence = await f.settled(created.id);
    if (sequence.status !== "completed") throw new Error(`Generated canonical proposal needs its actual completed roles, not ${sequence.status}: ${sequence.diagnostic ?? "No terminal diagnostic."}`);
    return { ...f, sequence, reference: { roleSequenceId: sequence.id }, patch: roleProposalPatch };
  } catch (error) { await f.close(); throw error; }
}
