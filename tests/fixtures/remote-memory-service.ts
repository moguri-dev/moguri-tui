import { MoguriSdk } from "../../packages/sdk/src/index.ts";
import { remoteFixture } from "./remote-service.ts";

export async function remoteMemoryFixture(options: { exposeModels?: boolean } = {}) {
  const f = await remoteFixture({ exposeModels: options.exposeModels ?? false }), sdk = await new MoguriSdk(f.service.connection).ready();
  try {
    const settings = structuredClone(sdk.settings.get()!.values); settings.memory.enabled = true;
    await sdk.settings.update(settings, sdk.settings.get()!.revision); await f.probe();
    await sdk.sessions.env(f.sessionId, "Remote");
    return { ...f, sdk, close: async () => { sdk.disconnect(); await f.close(); } };
  } catch (error) { sdk.disconnect(); await f.close(); throw error; }
}
