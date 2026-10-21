import { readFile, writeFile, rename } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { isRecord } from "../../packages/protocol/src/index.ts";
import type { SecretVault } from "../../apps/service/src/gateway.ts";

export class GeneratedFileVault implements SecretVault {
  private chain: Promise<unknown> = Promise.resolve();
  constructor(private readonly path: string) {}
  private async values(): Promise<Record<string, string>> {
    let value: unknown;
    try { value = JSON.parse(await readFile(this.path, "utf8")); }
    catch (error) { if (error instanceof Error && "code" in error && error.code === "ENOENT") return {}; throw error; }
    if (!isRecord(value) || !Object.values(value).every((entry) => typeof entry === "string")) throw new Error("Generated fixture vault is corrupt.");
    return Object.fromEntries(Object.entries(value).map(([id, token]) => [id, String(token)]));
  }
  async read(id: string, signal?: AbortSignal) { signal?.throwIfAborted(); return (await this.values())[id] ?? null; }
  private change(id: string, token: string | null, signal?: AbortSignal): Promise<void> {
    const run = async () => {
      signal?.throwIfAborted();
      const values = await this.values(); if (token === null) delete values[id]; else values[id] = token;
      const temporary = `${this.path}.${randomUUID()}.tmp`;
      await writeFile(temporary, JSON.stringify(values), { flag: "wx", mode: 0o600 }); await rename(temporary, this.path);
    };
    const next = this.chain.then(run, run); this.chain = next; return next;
  }
  write(id: string, token: string, signal?: AbortSignal) { return this.change(id, token, signal); }
  remove(id: string, signal?: AbortSignal) { return this.change(id, null, signal); }
}
