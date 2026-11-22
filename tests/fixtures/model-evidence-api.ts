import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { CopilotAdapter } from "@moguri-dev/sdk/testing";
import { MoguriSdk } from "@moguri-dev/sdk";
import { setupFixture } from "../fixture.ts";

export async function modelEvidenceFixture() {
  const f = await setupFixture(), sdk = await new MoguriSdk(f.service.connection).ready(), originalFetch = globalThis.fetch;
  const credentials = new InMemoryCredentialStore(); let reads = 0, gate: Promise<void> | undefined;
  let catalogue: unknown = { data: [{ id: f.modelId, vendor: "Generated provider claim", version: "generated-catalogue-version",
    capabilities: { family: "generated-provider-declared-family" } }] };
  await credentials.modify("github-copilot", async () => ({
    type: "oauth", refresh: "generated-unused-refresh", access: "generated-metadata-access-only", expires: Date.now() + 3_600_000, availableModelIds: [f.modelId],
  }));
  const adapter = new CopilotAdapter(credentials); await adapter.refresh();
  const cancel = f.provider.cancel.bind(f.provider), logout = f.provider.logout.bind(f.provider);
  Object.assign(f.provider, {
    evidence: (id: string, signal: AbortSignal) => adapter.evidence(id, signal),
    cancel: async () => { await adapter.cancel(); await cancel(); },
    logout: async () => { await adapter.logout(); await logout(); },
  });
  globalThis.fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url === "https://api.individual.githubcopilot.com/models") {
      reads++; if (gate) await gate;
      init?.signal?.throwIfAborted();
      return Response.json(catalogue);
    }
    return originalFetch(input, init);
  };
  try {
    await f.configure(); await sdk.refresh();
    return { ...f, sdk, adapter, reads: () => reads, hold: (value: Promise<void> | undefined) => { gate = value; }, catalogue: (value: unknown) => { catalogue = value; },
      close: async () => { sdk.disconnect(); try { await adapter.cancel(); await f.close(); } finally { globalThis.fetch = originalFetch; } } };
  } catch (error) {
    sdk.disconnect(); try { await adapter.cancel(); await f.close(); } finally { globalThis.fetch = originalFetch; }
    throw error;
  }
}
