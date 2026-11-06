import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { MoguriSdk, type CandidatePatch } from "../../packages/sdk/src/index.ts";
import { digest } from "../../apps/service/src/store.ts";
import { setupFixture } from "../fixture.ts";
import { initializeGeneratedRepository } from "./git-project.ts";

export async function candidateApiFixture(options: Parameters<typeof setupFixture>[0] = {}) {
  options.nodePrimitives ??= true;
  const f = await setupFixture(options), sdk = new MoguriSdk(f.service.connection);
  try {
    await sdk.ready();
    await writeFile(join(f.project, "second.txt"), "Generated second base.\n");
    const git = initializeGeneratedRepository(f.project, ["fixture.txt", "second.txt"]);
    const created = await sdk.workspaces.create(f.session().projectId, "moguri/generated-candidate-api"), workspace = await sdk.workspaces.wait(created.id!);
    const patch: CandidatePatch = { kind: "patch", summary: "Generated candidate API proposal.", edits: [
      { path: "fixture.txt", baseDigest: digest("generated original\n"), text: "Generated candidate API file.\n" },
    ] };
    return { ...f, sdk, git, workspace, patch,
      stage: async (input = patch) => {
        const preview = (await sdk.candidates.preview(f.sessionId, workspace.id, input)).preview;
        return sdk.candidates.wait((await sdk.candidates.stage(f.sessionId, workspace.id, input, preview.digest)).id!);
      },
      close: async () => { sdk.disconnect(); await f.close(); } };
  } catch (error) { sdk.disconnect(); await f.close(); throw error; }
}
