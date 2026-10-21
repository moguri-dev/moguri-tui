import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { digest } from "../../apps/service/src/store.ts";
import type { OwnedRoleInput } from "../../apps/service/src/owned-roles.ts";
import type { WorkspaceFinish } from "../../apps/service/src/session-workspace.ts";
import { projectEvents, type CommandResult } from "../../packages/sdk/src/index.ts";
import { waitFor, type GeneratedProviderOptions } from "../fixture.ts";
import { candidateApiFixture } from "./candidate-api.ts";

export const ownedRoleMarker = "GENERATED_OWNED_ROLE_RESULT_NOT_ACCEPTANCE";
export async function ownedSequenceFixture(options: GeneratedProviderOptions = {}) {
  const providerOptions: GeneratedProviderOptions & { workerPath: string } = { replyText: ownedRoleMarker, responseMode: "text", maxOutputTokens: 256,
    workerPath: fileURLToPath(new URL("../../apps/service/src/worker.ts", import.meta.url)), ...options };
  const f = await candidateApiFixture(providerOptions);
  try {
    await f.configure();
    const control = f.service.controller, execution = control.ownedRoles;
    const input: OwnedRoleInput = { sessionId: f.sessionId, stageWorkspaceId: f.workspace.id,
      input: { task: "Generated bounded role operation.", files: [{ path: "fixture.txt", baseDigest: digest("generated original\n") }] },
      roles: ["draft", "critic", "revision"].map((role) => ({
        role: role === "draft" ? "draft" : role === "critic" ? "critic" : "revision", modelId: f.modelId,
        instruction: `Return generated ${role} data. This fixture does not establish independent family or quality.`, outputBound: 64,
      })), timeoutMs: 20_000 };
    const finish = (commandId: string, commandDigest: string): WorkspaceFinish => Object.assign((events: Parameters<WorkspaceFinish>[0], result: CommandResult = {}) => {
      control.store.commit(events, { id: commandId, digest: commandDigest, result }, undefined, (primary) => {
        const next = { ...control.snapshot(), ...projectEvents([...control.events(0), ...primary], control.profileId) };
        return [...control.platform.budgets.derived(next, primary), ...control.platform.roles.derived(next, primary)];
      });
      control.refreshProfile(); return result;
    }, { intent: { id: commandId, digest: commandDigest } });
    const start = async (value = input, commandId: string = randomUUID()) => {
      const prepared = await execution.preview(value), review = { digest: prepared.digest, confirmCost: true as const };
      const started = await control.executeOwnedRoles(value, review, commandId);
      if (!started.id) throw new Error("Generated owned sequence admission returned no original identity.");
      const commandDigest = execution.record(started.id).commandDigest;
      return { id: started.id, commandId, commandDigest, prepared, value, review };
    };
    const current = (id: string) => execution.record(id);
    const settled = async (id: string) => waitFor(() => {
      const record = current(id);
      return record.status !== "running" && !f.session().turnId ? record : null;
    }, 12_000);
    return { ...f, control, execution, input, providerOptions, finish, start, current, settled };
  } catch (error) { await f.close(); throw error; }
}
