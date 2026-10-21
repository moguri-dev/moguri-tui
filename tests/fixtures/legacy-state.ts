import { DatabaseSync } from "node:sqlite";
import assert from "node:assert/strict";
import type { startService } from "../../apps/service/src/server.ts";
import { PROTOCOL_VERSION } from "../../packages/protocol/src/index.ts";

export function assertCurrentSchema(store: { db: DatabaseSync }): void {
  assert.equal(store.db.prepare("PRAGMA user_version").get()?.user_version, PROTOCOL_VERSION);
}
export function retainedCiphertextRows(db: DatabaseSync) {
  return ["events", "retention_keys", "retention_forgotten", "blob_payloads", "receipts", "memory_scopes", "memory_files", "memory_chunks", "memory_graph_nodes", "memory_graph_edges"]
    .map((table) => [table, db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]);
}
export async function writeLegacyState(service: Awaited<ReturnType<typeof startService>>, version: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19 | 20 | 21 | 22 | 23 | 24 | 25 | 26 | 27 | 28 | 29 | 30 | 31 | 32): Promise<void> {
  const events = service.store.db.isOpen ? service.store.events() : service.controller.events(0);
  if (events.some((event) => event.event_type === "candidate.saved" && event.payload.candidate.roleOrigin)) throw new Error("Generate pre-role-proposal history for a legacy fixture; do not relabel future candidate model origin as an older schema.");
  if (version < 32 && events.some((event) => event.event_type === "role.sequence_recorded" || event.event_type === "turn.control_started" && event.payload.purpose === "role.sequence")) throw new Error("Generate pre-sequence history for a legacy fixture; do not relabel future role metadata as an older schema.");
  if (version < 31 && events.some((event) => event.event_type === "candidate.generation_recorded" ||
    event.event_type === "turn.control_started" && event.payload.purpose === "candidate.generate" ||
    event.event_type === "model.started" && event.payload.role === "draft" ||
    event.event_type === "budget.recorded" && event.payload.entry.role === "draft" ||
    event.event_type === "budget.plan_recorded" && event.payload.plan.role === "draft")) throw new Error("Generate pre-generation history for a legacy fixture; do not relabel future model generations/draft roles as an older schema.");
  if (version >= 4) {
    const path = service.store.path; await service.close();
    const db = new DatabaseSync(path);
    try {
      if (version < 32 && Number(db.prepare("SELECT count(*) AS count FROM events WHERE json_extract(data,'$.event_type')='role.sequence_recorded'").get()?.count)) throw new Error("Generate pre-sequence history for a legacy fixture; do not relabel future role metadata as an older schema.");
      if (version < 31 && Number(db.prepare("SELECT count(*) AS count FROM events WHERE json_extract(data,'$.event_type')='candidate.generation_recorded'").get()?.count)) throw new Error("Generate pre-generation history for a legacy fixture; do not relabel future model generations as an older schema.");
      if (version < 30 && Number(db.prepare("SELECT count(*) AS count FROM events WHERE json_extract(data,'$.event_type')='budget.plan_recorded'").get()?.count)) throw new Error("Generate pre-planning history for a legacy fixture; do not relabel future budget plans as an older schema.");
      if (version < 29 && Number(db.prepare("SELECT count(*) AS count FROM events WHERE json_extract(data,'$.event_type')='candidate.saved'").get()?.count)) throw new Error("Generate pre-candidate history for a legacy fixture; do not relabel future events as an older schema.");
      if (version >= 14) {
        db.exec(`BEGIN IMMEDIATE; DELETE FROM retention_metadata WHERE id='candidate_role_schema';
          ${version < 32 ? "DELETE FROM retention_metadata WHERE id='role_sequence_schema';" : ""}
          ${version < 31 ? "DELETE FROM retention_metadata WHERE id='candidate_generation_schema';" : ""}
          ${version < 30 ? "DELETE FROM retention_metadata WHERE id='budget_planning_schema';" : ""}
          ${version < 29 ? "DELETE FROM retention_metadata WHERE id='candidate_execution_schema';" : ""}
          ${version < 28 ? "DELETE FROM retention_metadata WHERE id='candidate_workflow_schema';" : ""}
          ${version < 27 ? "DROP TABLE memory_scopes; DELETE FROM retention_metadata WHERE id='remote_memory_schema';" : ""}
          ${version < 26 ? "DELETE FROM retention_metadata WHERE id='remote_repository_schema';" : ""}
          ${version < 25 ? "DELETE FROM retention_metadata WHERE id='remote_terminal_schema';" : ""}
          ${version < 24 ? "DELETE FROM retention_metadata WHERE id='remote_mcp_schema';" : ""}
          ${version < 23 ? "DELETE FROM retention_metadata WHERE id='terminal_ownership_schema';" : ""}
          ${version < 22 ? "DELETE FROM retention_metadata WHERE id='repository_attribution_schema';" : ""}
          ${version < 21 ? "DELETE FROM retention_metadata WHERE id='operation_metrics_schema';" : ""}
          ${version < 20 ? "DELETE FROM retention_metadata WHERE id='remote_plan_save_schema';" : ""}
          ${version < 19 ? "DELETE FROM retention_metadata WHERE id='context_compaction_schema';" : ""}
          ${version < 18 ? "DELETE FROM retention_metadata WHERE id='stream_telemetry_schema';" : ""}
          ${version < 17 ? "DELETE FROM retention_metadata WHERE id='remote_workspace_read_schema';" : ""}
          ${version < 16 ? "DELETE FROM retention_metadata WHERE id='single_routing_schema';" : ""}
          ${version === 14 ? "DELETE FROM retention_metadata WHERE id='guided_advice_schema';" : ""}
          PRAGMA user_version=${version}; COMMIT;`);
        return;
      }
      if (Number(db.prepare("SELECT count(*) AS count FROM events WHERE json_extract(data,'$.profile_id') NOT IN ('default','_global')").get()?.count)) throw new Error("Generate Default-only legacy fixtures without dropping another user profile.");
      db.exec(`BEGIN IMMEDIATE; DROP TABLE memory_scopes; DELETE FROM retention_metadata WHERE id IN ('remote_memory_schema','candidate_workflow_schema','candidate_execution_schema','budget_planning_schema','candidate_generation_schema','role_sequence_schema','candidate_role_schema'); DROP TRIGGER events_no_delete;
        DELETE FROM events WHERE json_extract(data,'$.profile_id')='_global';
        CREATE TRIGGER events_no_delete BEFORE DELETE ON events BEGIN SELECT RAISE(ABORT,'events are append-only'); END;`);
      for (const table of ["blob_payloads", "retention_keys", "retention_forgotten"]) db.prepare(`DELETE FROM ${table} WHERE scope='profile/_global' OR scope GLOB 'profile/_global/*'`).run();
      if (db.prepare("PRAGMA table_info(receipts)").all().some((column) => column.name === "profile_id")) {
        if (Number(db.prepare("SELECT count(*) AS count FROM receipts WHERE profile_id<>'default'").get()?.count)) throw new Error("A legacy fixture cannot discard scoped command receipts.");
        db.exec(`CREATE TABLE receipts_legacy(id TEXT PRIMARY KEY,digest TEXT NOT NULL,result TEXT NOT NULL);
          INSERT INTO receipts_legacy SELECT id,digest,result FROM receipts WHERE profile_id='default';
          DROP TABLE receipts; ALTER TABLE receipts_legacy RENAME TO receipts;`);
      }
      db.exec(`DELETE FROM retention_metadata WHERE id IN ('profile_scope_schema','guided_advice_schema','single_routing_schema','remote_workspace_read_schema','stream_telemetry_schema','context_compaction_schema','remote_plan_save_schema','operation_metrics_schema','repository_attribution_schema','terminal_ownership_schema','remote_mcp_schema','remote_terminal_schema','remote_repository_schema');
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
  if (events.some((event) => event.event_type === "budget.plan_recorded")) throw new Error("Generate pre-planning history for a legacy fixture; do not relabel future budget plans as an older schema.");
  if (events.some((event) => event.event_type === "candidate.saved")) throw new Error("Generate pre-candidate history for a legacy fixture; do not relabel future events as an older schema.");
  const blobs = service.store.db.prepare("SELECT DISTINCT digest FROM blob_payloads").all().map((row) => [String(row.digest), service.store.blob(String(row.digest))] as const);
  const path = service.store.path;
  await service.close();
  const db = new DatabaseSync(path);
  try {
    db.exec(`BEGIN IMMEDIATE; DROP TABLE memory_scopes; DROP TABLE events; DROP TABLE blob_payloads; DROP TABLE retention_keys; DROP TABLE retention_forgotten; DROP TABLE retention_metadata;
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
