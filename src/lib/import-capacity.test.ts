import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const sql = readFileSync("drizzle/migrations/0014_import_session_capacity_and_finish.sql", "utf8");
describe("Import capacity safeguards (migration contract)", () => {
  it("serializes creation by user/space and requires the exact oldest approval", () => {
    expect(sql).toContain("pg_advisory_xact_lock");
    expect(sql).toContain("_replace IS DISTINCT FROM oldest.id");
    expect(sql.indexOf("_replace IS DISTINCT FROM oldest.id")).toBeLessThan(sql.indexOf("DELETE FROM import_sessions"));
    expect(sql).toContain("ORDER BY created_at,id");
  });
  it("checks idempotency before capacity and preserves saved provenance and sources", () => {
    expect(sql.indexOf("'reused',true")).toBeLessThan(sql.indexOf("SELECT * INTO oldest"));
    expect(sql).toContain("session_id=oldest.id AND status='saved'");
    expect(sql).not.toContain("DELETE FROM source_posts");
    expect(sql).not.toContain("DELETE FROM works");
  });
  it("protects direct inserts and completes remaining decisions transactionally", () => {
    expect(sql).toContain("BEFORE INSERT OR UPDATE OF status");
    expect(sql).toContain("public.import_complete(_session)");
    expect(sql).toContain("status IN ('pending','error')");
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.import_finish_remaining(uuid) FROM PUBLIC,anon");
  });
});