import { DatabaseSync } from "node:sqlite";
import type { startService } from "../../apps/service/src/server.ts";

export async function writeLegacyState(service: Awaited<ReturnType<typeof startService>>, version: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14): Promise<void> {
  if (version >= 4) {
    const path = service.store.path; await service.close();
    const db = new DatabaseSync(path);
    try {
      if (version === 14) {
        db.exec("BEGIN IMMEDIATE; DELETE FROM retention_metadata WHERE id='guided_advice_schema'; PRAGMA user_version=14; COMMIT;");
        return;
      }
      if (Number(db.prepare("SELECT count(*) AS count FROM events WHERE json_extract(data,'$.profile_id') NOT IN ('default','_global')").get()?.count)) throw new Error("Generate Default-only legacy fixtures without dropping another user profile.");
      db.exec(`BEGIN IMMEDIATE; DROP TRIGGER events_no_delete;
        DELETE FROM events WHERE json_extract(data,'$.profile_id')='_global';
        CREATE TRIGGER events_no_delete BEFORE DELETE ON events BEGIN SELECT RAISE(ABORT,'events are append-only'); END;`);
      for (const table of ["blob_payloads", "retention_keys", "retention_forgotten"]) db.prepare(`DELETE FROM ${table} WHERE scope='profile/_global' OR scope GLOB 'profile/_global/*'`).run();
      if (db.prepare("PRAGMA table_info(receipts)").all().some((column) => column.name === "profile_id")) {
        if (Number(db.prepare("SELECT count(*) AS count FROM receipts WHERE profile_id<>'default'").get()?.count)) throw new Error("A legacy fixture cannot discard scoped command receipts.");
        db.exec(`CREATE TABLE receipts_legacy(id TEXT PRIMARY KEY,digest TEXT NOT NULL,result TEXT NOT NULL);
          INSERT INTO receipts_legacy SELECT id,digest,result FROM receipts WHERE profile_id='default';
          DROP TABLE receipts; ALTER TABLE receipts_legacy RENAME TO receipts;`);
      }
      db.exec(`DELETE FROM retention_metadata WHERE id IN ('profile_scope_schema','guided_advice_schema');
        ${version < 13 ? "DELETE FROM retention_metadata WHERE id='budget_ledger_schema';" : ""}
        ${version < 12 ? "DELETE FROM retention_metadata WHERE id='artifact_repository_schema';" : ""}
        ${version < 11 ? "DELETE FROM retention_metadata WHERE id='structured_question_schema';" : ""}
        ${version < 10 ? "DELETE FROM retention_metadata WHERE id='retained_artifact_schema';" : ""}
        ${version < 9 ? "DELETE FROM retention_metadata WHERE id='managed_workspace_schema';" : ""}
        ${version < 8 ? "DELETE FROM retention_metadata WHERE id='execution_transport_schema';" : ""}
        ${version < 7 ? "DELETE FROM retention_metadata WHERE id='runtime_foundation_schema';" : ""}
        ${version < 6 ? "DELETE FROM retention_metadata WHERE id='engagement_schema';" : ""}
        ${version === 4 ? "DELETE FROM retention_metadata WHERE id='model_controls_schema';" : ""}
        PRAGMA user_version=${version}; COMMIT;`);
    } catch (error) { if (db.isTransaction) db.exec("ROLLBACK"); throw error; }
    finally { db.close(); }
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
