import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MoguriSdk } from "../../packages/sdk/src/index.ts";
import { startService } from "../../apps/service/src/server.ts";
import type { PlatformOptions } from "../../apps/service/src/platform.ts";
import { fixtureProvider } from "../fixture.ts";

export async function profileFixture(extra?: (profileId: string, directory: string) => PlatformOptions, workerPath?: string, holdAfterTool = false) {
  const directory = await mkdtemp(join(tmpdir(), "moguri-generated-profiles-")), stateDir = join(directory, "state"), key = Buffer.alloc(32, 0x6a);
  const providers = await Promise.all([fixtureProvider({ maxOutputTokens: 128, exposeModels: true, holdAfterTool }), fixtureProvider({ maxOutputTokens: 128, exposeModels: true, holdAfterTool }), fixtureProvider({ maxOutputTokens: 128, exposeModels: true, holdAfterTool })]);
  const assigned = new Map<string, typeof providers[number]>([["default", providers[0]!]]), vaults = new Map<string, Map<string, string>>();
  const options = { stateDir, retentionKey: key, workerPath, profiles: {
    provider: (id: string) => {
      let provider = assigned.get(id);
      if (!provider) { provider = providers[assigned.size]; if (!provider) throw new Error("Generated provider pool exhausted"); assigned.set(id, provider); }
      return provider.provider;
    },
    platform: (id: string) => {
      let values = vaults.get(id); if (!values) { values = new Map(); vaults.set(id, values); }
      const scoped = values;
      return { ...extra?.(id, directory), vault: { read: async (key: string) => scoped.get(key) ?? null, write: async (key: string, value: string) => { scoped.set(key, value); }, remove: async (key: string) => { scoped.delete(key); } } };
    },
  } };
  const service = await startService(options), sdk = await new MoguriSdk(service.connection).ready(), clients: MoguriSdk[] = [sdk];
  const create = async (name: string) => {
    const command = await sdk.profiles.create(name, "#557799");
    const profile = await sdk.profiles.wait(command.id!), client = await sdk.profiles.open(profile.id); clients.push(client);
    return { profile, client };
  };
  const session = (client: MoguriSdk, id: string) => {
    const value = client.getState().snapshot!.sessions.find((session) => session.id === id);
    if (!value) throw new Error("Generated scoped session is missing."); return value;
  };
  const send = async (client: MoguriSdk, id: string, text: string) => {
    await client.refresh(); const current = session(client, id);
    await client.command({ type: "draft.save", sessionId: id, expectedRevision: current.draft.revision, text, attachments: [] });
    await client.command({ type: "message.send", sessionId: id, expectedRevision: current.draft.revision + 1, delivery: "queue" });
  };
  return { directory, stateDir, key, options, providers, assigned, vaults, service, sdk, clients, create, session, send,
    close: async () => { for (const client of clients) client.disconnect(); await service.close(); for (const provider of providers) await provider.close(); await rm(directory, { recursive: true, force: true }); } };
}
