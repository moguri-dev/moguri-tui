import { MoguriSdk } from "@moguri-dev/sdk";
import { remoteFixture } from "./remote-service.ts";

export async function remotePlanFixture() {
  const fixture = await remoteFixture({ exposeModels: false }), sdk = await new MoguriSdk(fixture.service.connection).ready();
  try {
    await fixture.probe();
    await sdk.sessions.configure(fixture.sessionId, { ...fixture.session().controls, env: "Remote", modelId: null });
    const bindingDigest = (await sdk.plans.read(fixture.sessionId)).bindingDigest;
    if (!bindingDigest) throw new Error("The generated Remote plan has no reviewed binding.");
    return { ...fixture, sdk, bindingDigest, close: async () => { sdk.disconnect(); await fixture.close(); } };
  } catch (error) { sdk.disconnect(); await fixture.close(); throw error; }
}
