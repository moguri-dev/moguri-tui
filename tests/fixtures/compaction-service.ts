import { MoguriSdk } from "@moguri-dev/sdk";
import { setupFixture, type GeneratedProviderOptions } from "../fixture.ts";

export async function compactionFixture(configuration: GeneratedProviderOptions = { responseMode: "text", replyText: "Generated summary: preserve the fixture task, completed observations and unresolved work." }) {
  const fixture = await setupFixture(configuration);
  try {
    await fixture.configure();
    for (let turn = 0; turn < 3; turn++) {
      await fixture.send(`Generated original turn ${turn}. ` + `Generated detail ${turn}. `.repeat(160));
      const result = await fixture.terminal();
      if (result.status !== "completed") throw new Error("Generated compaction source history did not finish.");
    }
    const sdk = await new MoguriSdk(fixture.service.connection).ready();
    return { ...fixture, sdk, configuration, close: async () => { sdk.disconnect(); await fixture.close(); } };
  } catch (error) {
    await fixture.close(); throw error;
  }
}
