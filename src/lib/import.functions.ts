import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { findImdb, lookupTmdb, type TmdbSearchItem } from "./tmdb.server";
import { fetchCaption } from "./social.server";
import { extractSocial, sourceUrl } from "./social-url";
import { runImportAnalysis } from "./ai.functions";
import { ensureWork } from "./catalog.functions";

/**
 * Import sessions are personal (created_by) and persisted: reload/PWA close resumes without repeating
 * TMDB/Gemini. Sources (source_posts) are one per space+canonical URL; candidates keep their own source.
 * Session/candidate rows are written server-side (service role) after verifying the caller's membership;
 * user-facing confirm/undo run as RPCs under the caller's identity.
 */
const CAPTION_COOLDOWN_MS = 6 * 3600_000;
type Item = TmdbSearchItem;

async function admin() {
  return (await import("@/integrations/supabase/client.server")).supabaseAdmin;
}

async function ownSession(supabase: { from: (t: "import_sessions") => any }, sessionId: string) {
  const { data, error } = await supabase.from("import_sessions").select("*").eq("id", sessionId).maybeSingle();
  if (error || !data) throw new Error("Sessão não encontrada.");
  return data as { id: string; space_id: string; created_by: string; status: string; shared_title: string | null; shared_text: string | null; shared_url: string | null; source_post_ids: string[]; ai_done: boolean };
}

async function addCandidates(sessionId: string, spaceId: string, userId: string, items: Item[], sourcePostId: string | null) {
  const db = await admin();
  const { count } = await db.from("import_candidates").select("id", { count: "exact", head: true }).eq("session_id", sessionId);
  const rows = items.map((f, i) => ({ session_id: sessionId, space_id: spaceId, created_by: userId, source_post_id: sourcePostId, position: (count ?? 0) + i, media_type: f.mediaType, tmdb_id: f.tmdbId, title: f.title, original_title: f.originalTitle, year: f.year, poster_path: f.posterPath, backdrop_path: f.backdropPath }));
  // Same work from the same source in this session is one candidate; distinct sources keep separate provenance.
  for (const r of rows) {
    const { error } = await db.from("import_candidates").insert(r);
    if (error && error.code !== "23505") throw new Error("Não foi possível guardar os candidatos.");
  }
}

async function setStatus(sessionId: string, patch: Record<string, unknown>) {
  const { error } = await (await admin()).from("import_sessions").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", sessionId);
  if (error) throw new Error("Não foi possível atualizar a sessão.");
}

async function refreshStatus(sessionId: string, fallback: "needs_help" | "interrupted" = "needs_help") {
  const db = await admin();
  const { count } = await db.from("import_candidates").select("id", { count: "exact", head: true }).eq("session_id", sessionId);
  await setStatus(sessionId, { status: (count ?? 0) > 0 ? "review" : fallback });
}

/** Captures a share/manual entry immediately. title/text/url stay separate (URL never truncated by concatenation). */
export const createImportSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ spaceId: z.string().uuid(), origin: z.enum(["share", "manual", "capture"]), title: z.string().max(300).optional(), text: z.string().max(4000).optional(), url: z.string().max(2000).optional(), sourcePostId: z.string().uuid().optional() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: member } = await supabase.from("space_members").select("id").eq("space_id", data.spaceId).eq("user_id", userId).maybeSingle();
    if (!member) throw new Error("Sem acesso a este espaço.");
    const refs = extractSocial([data.url, data.text, data.title].filter(Boolean).join("\n"), 12);
    const ids: string[] = [];
    if (data.sourcePostId) ids.push(data.sourcePostId);
    for (const r of refs) {
      const url = sourceUrl(r);
      // One source per space+URL: the first author is kept; a second sender reuses it.
      await supabase.from("source_posts").insert({ space_id: data.spaceId, platform: r.platform === "instagram" ? "instagram" : "tiktok", source_url: url, created_by: userId });
      const { data: row } = await supabase.from("source_posts").select("id").eq("space_id", data.spaceId).eq("source_url", url).maybeSingle();
      if (row && !ids.includes(row.id)) ids.push(row.id);
    }
    const { data: s, error } = await (await admin()).from("import_sessions").insert({ space_id: data.spaceId, created_by: userId, origin: data.origin, shared_title: data.title ?? null, shared_text: data.text ?? null, shared_url: data.url ?? null, source_post_ids: ids }).select("id").single();
    if (error) throw new Error("Não foi possível criar a sessão.");
    return { sessionId: s.id as string };
  });

/** Deterministic step (no AI): TMDB links / IMDb ids in the session's own text. */
export const resolveSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ sessionId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const s = await ownSession(context.supabase, data.sessionId);
    const text = [s.shared_url, s.shared_text, s.shared_title].filter(Boolean).join("\n");
    const tmdb = [...text.matchAll(/themoviedb\.org\/(movie|tv)\/(\d{1,9})/gi)].map((m) => ({ mediaType: m[1]!.toLowerCase() as "movie" | "tv", id: Number(m[2]) }));
    const imdb = [...new Set([...text.matchAll(/\b(tt\d{7,9})\b/gi)].map((m) => m[1]!.toLowerCase()))];
    const found: Item[] = [];
    for (const t of tmdb.slice(0, 12)) { const item = await lookupTmdb(t.mediaType, t.id); if (item) found.push(item); }
    for (const id of imdb.slice(0, 12)) found.push(...(await findImdb(id)).slice(0, 1));
    if (found.length) await addCandidates(s.id, s.space_id, s.created_by, found, null);
    await refreshStatus(s.id, s.source_post_ids.length ? "needs_help" : "needs_help");
    return { found: found.length };
  });

/** Explicit tap: public caption per source (cooldown, persisted on the source). Up to 3 sources per call. */
export const fetchSessionCaptions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ sessionId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const s = await ownSession(context.supabase, data.sessionId);
    const { data: posts } = await context.supabase.from("source_posts").select("id, source_url, caption, caption_status, caption_fetched_at").in("id", s.source_post_ids.length ? s.source_post_ids : ["00000000-0000-0000-0000-000000000000"]);
    const db = await admin();
    let fetched = 0;
    for (const p of posts ?? []) {
      if (fetched >= 3) break;
      if (p.caption || (p.caption_fetched_at && Date.now() - new Date(p.caption_fetched_at).getTime() < CAPTION_COOLDOWN_MS)) continue;
      const ref = extractSocial(p.source_url, 1)[0];
      if (!ref) continue;
      fetched++;
      const r = await fetchCaption(ref).catch(() => null);
      await db.from("source_posts").update({ caption: r?.caption ?? null, caption_status: r?.status ?? "unavailable", caption_fetched_at: new Date().toISOString() }).eq("id", p.id);
    }
    return { fetched };
  });

/** Explicit tap: Gemini on one source caption (candidates attributed to that source) or on the session text/capture. */
export const analyzeSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ sessionId: z.string().uuid(), sourcePostId: z.string().uuid().optional(), text: z.string().max(4000).optional(), image: z.object({ mimeType: z.enum(["image/png", "image/jpeg", "image/webp"]), base64: z.string().max(6_000_000) }).optional() }).parse(d))
  .handler(async ({ data, context }) => {
    const s = await ownSession(context.supabase, data.sessionId);
    let text = data.text;
    let source: string | null = null;
    if (data.sourcePostId) {
      if (!s.source_post_ids.includes(data.sourcePostId)) throw new Error("Fonte fora desta sessão.");
      const { data: p } = await context.supabase.from("source_posts").select("caption").eq("id", data.sourcePostId).maybeSingle();
      if (!p?.caption) return { ok: false as const, reason: "Esta fonte não tem legenda. Envie uma captura." };
      text = p.caption;
      source = data.sourcePostId;
    } else if (s.source_post_ids.length === 1) source = s.source_post_ids[0]!; // single source: capture/text belongs to it
    if (!text && !data.image) return { ok: false as const, reason: "Envie texto ou captura." };
    const r = await runImportAnalysis({ supabase: context.supabase, userId: context.userId, spaceId: s.space_id, ...(text ? { text } : {}), ...(data.image ? { image: data.image } : {}) });
    if (!r.ok) { await refreshStatus(s.id, "interrupted"); return { ok: false as const, reason: r.reason }; }
    if (r.items.length) await addCandidates(s.id, s.space_id, s.created_by, r.items, source);
    await setStatus(s.id, { ai_done: true });
    await refreshStatus(s.id);
    return { ok: true as const, found: r.items.length };
  });

/** Correction only for undecided candidates (undo first if saved), TMDB-validated. */
export const correctCandidate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ candidateId: z.string().uuid(), mediaType: z.enum(["movie", "tv"]), tmdbId: z.number().int().positive() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: c } = await context.supabase.from("import_candidates").select("id, session_id, source_post_id, status").eq("id", data.candidateId).maybeSingle();
    if (!c) throw new Error("Candidato não encontrado.");
    if (c.status === "saved") throw new Error("Desfaça a confirmação antes de corrigir.");
    const t = await lookupTmdb(data.mediaType, data.tmdbId);
    if (!t) throw new Error("Obra não encontrada no TMDB.");
    const { error } = await (await admin()).from("import_candidates").update({ media_type: t.mediaType, tmdb_id: t.tmdbId, title: t.title, original_title: t.originalTitle, year: t.year, poster_path: t.posterPath, backdrop_path: t.backdropPath, corrected: true, status: "pending", note: null, updated_at: new Date().toISOString() }).eq("id", c.id).neq("status", "saved");
    if (error) throw new Error(error.code === "23505" ? "Essa obra já está nesta sessão para a mesma fonte." : "Não foi possível corrigir.");
    return { ok: true };
  });

/** Confirm: ensure the TMDB-validated work, then one transactional RPC (indication, reaction, seen, source link, status). Idempotent. */
export const confirmCandidate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ candidateId: z.string().uuid(), reaction: z.enum(["fire", "like", "neutral"]) }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: c } = await supabase.from("import_candidates").select("id, space_id, media_type, tmdb_id, seen, status, work_id").eq("id", data.candidateId).maybeSingle();
    if (!c) throw new Error("Candidato não encontrado.");
    try {
      const workId = c.status === "saved" && c.work_id ? c.work_id : await ensureWork(supabase, userId, { spaceId: c.space_id, mediaType: c.media_type, tmdbId: c.tmdb_id });
      const { data: r, error } = await supabase.rpc("import_confirm", { _candidate: c.id, _work: workId, _reaction: data.reaction, _seen: c.seen });
      if (error) throw new Error(error.message);
      return r as { status: string; indication?: "created" | "renewed"; idempotent: boolean };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Falha";
      await (await admin()).from("import_candidates").update({ status: "error", note: "Não foi possível confirmar. Nada desta obra foi gravado; tente de novo.", updated_at: new Date().toISOString() }).eq("id", c.id).neq("status", "saved");
      throw new Error(msg.startsWith("Não") ? msg : "Não foi possível confirmar. Tente de novo.");
    }
  });
