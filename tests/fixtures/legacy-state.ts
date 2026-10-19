import { DatabaseSync } from "node:sqlite";
import type { startService } from "../../apps/service/src/server.ts";

export async function writeLegacyState(service: Awaited<ReturnType<typeof startService>>, version: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9): Promise<void> {
  if (version >= 4) {
    const path = service.store.path; await service.close();
    const db = new DatabaseSync(path);
    try { db.exec(`BEGIN IMMEDIATE; DELETE FROM retention_metadata WHERE id='retained_artifact_schema'; ${version < 9 ? "DELETE FROM retention_metadata WHERE id='managed_workspace_schema';" : ""} ${version < 8 ? "DELETE FROM retention_metadata WHERE id='execution_transport_schema';" : ""} ${version < 7 ? "DELETE FROM retention_metadata WHERE id='runtime_foundation_schema';" : ""} ${version < 6 ? "DELETE FROM retention_metadata WHERE id='engagement_schema';" : ""} ${version === 4 ? "DELETE FROM retention_metadata WHERE id='model_controls_schema';" : ""} PRAGMA user_version=${version}; COMMIT;`); } finally { db.close(); }
    return;
  }
  const events = service.store.events();
  const blobs = service.store.db.prepare("SELECT DISTINCT digest FROM blob_payloads").all().map((row) => [String(row.digest), service.store.blob(String(row.digest))] as const);
  const path = service.store.path;
  await service.close();
  const db = new DatabaseSync(path);
  try {
    db.exec(`BEGIN IMMEDIATE; DROP TABLE events; DROP TABLE blob_payloads; DROP TABLE retention_keys; DROP TABLE retention_forgotten; DROP TABLE retention_metadata;
      CREATE TABLE events(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL UNIQUE,data TEXT NOT NULL,payload TEXT NOT NULL);
      CREATE TABLE blobs(digest TEXT PRIMARY KEY,content TEXT NOT NULL);`);
    for (const event of events) {
      const { seq, ...data } = event;
      db.prepare("INSERT INTO events VALUES (?,?,?,?)").run(seq, event.id, JSON.stringify(data), JSON.stringify(event.payload));
    }
    for (const [hash, content] of blobs) db.prepare("INSERT INTO blobs VALUES (?,?)").run(hash, content);
    if (version === 1) db.exec("DROP TABLE memory_files; DROP TABLE memory_chunks; DROP TABLE memory_graph_nodes; DROP TABLE memory_graph_edges");
    if (version < 3) db.exec("DROP TABLE dependency_cache_objects");
    db.exec(`CREATE TRIGGER events_no_update BEFORE UPDATE ON events BEGIN SELECT RAISE(ABORT,'events are append-only'); END;
      CREATE TRIGGER events_no_delete BEFORE DELETE ON events BEGIN SELECT RAISE(ABORT,'events are append-only'); END; PRAGMA user_version=${version}; COMMIT;`);
  } catch (error) { if (db.isTransaction) db.exec("ROLLBACK"); throw error; }
  finally { db.close(); }
}
