import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { findImdb, findTitle, lookupTmdb, type TmdbSearchItem } from "./tmdb.server";
import { fetchCaption, needsCaptionFetch, VIDEO_PROBE_STATUS } from "./social.server";
import { explicitTitle } from "./explicit-title";
import { extractSocial, sourceUrl } from "./social-url";
import { runImportAnalysis } from "./ai.functions";
import { ensureWork } from "./catalog.functions";

/**
 * Import sessions are personal (created_by) and persisted: reload/PWA close resumes without repeating
 * TMDB/Gemini. Sources (source_posts) are one per space+canonical URL; candidates keep their own source.
 * Session/candidate rows are written server-side (service role) after verifying the caller's membership;
 * user-facing confirm/undo run as RPCs under the caller's identity.
 */
type Item = TmdbSearchItem;

function captionPatch(previous: { caption: string | null; caption_status: string | null }, result: Awaited<ReturnType<typeof fetchCaption>> | null) {
  // A failed enrichment must not erase a description that was already readable.
  if (!result?.caption) return previous.caption ? null : {
    caption: null, caption_status: result?.status ?? "unavailable", caption_fetched_at: new Date().toISOString(),
  };
  return { caption: result.caption, caption_status: result.videoProbed ? VIDEO_PROBE_STATUS : result.status,
    caption_fetched_at: new Date().toISOString() };
}

async function admin() {
  return (await import("@/integrations/supabase/client.server")).supabaseAdmin;
}

async function ownSession(supabase: { from: (t: "import_sessions") => any }, sessionId: string) {
  const { data, error } = await supabase.from("import_sessions").select("*").eq("id", sessionId).maybeSingle();
  if (error || !data) throw new Error("Sessão não encontrada.");
  return data as { id: string; space_id: string; created_by: string; status: string; origin: string; shared_title: string | null; shared_text: string | null; shared_url: string | null; source_post_ids: string[]; ai_done: boolean };
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
  // Never auto-completes: only import_complete (explicit decisions) can set "completed".
  const db = await admin();
  const { count, error } = await db.from("import_candidates").select("id", { count: "exact", head: true }).eq("session_id", sessionId);
  if (error) throw new Error("Não foi possível atualizar a sessão.");
  const { error: ue } = await db.from("import_sessions").update({ status: (count ?? 0) > 0 ? "review" : fallback, updated_at: new Date().toISOString() }).eq("id", sessionId).neq("status", "completed");
  if (ue) throw new Error("Não foi possível atualizar a sessão.");
}

/** Captures a share/manual entry immediately. title/text/url stay separate (URL never truncated by concatenation).
 * clientToken makes a reload of the same in-flight share idempotent; a later share uses a new token = new session. */
export const createImportSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ spaceId: z.string().uuid(), origin: z.enum(["share", "manual", "capture"]), title: z.string().max(300).optional(), text: z.string().max(4000).optional(), url: z.string().max(2000).optional(), sourcePostId: z.string().uuid().optional(), clientToken: z.string().regex(/^[0-9a-f-]{36}$/).optional() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: member, error: me } = await supabase.from("space_members").select("id").eq("space_id", data.spaceId).eq("user_id", userId).maybeSingle();
    if (me || !member) throw new Error("Sem acesso a este espaço.");
    const db = await admin();
    if (data.clientToken) {
      const { data: prior } = await db.from("import_sessions").select("id").eq("created_by", userId).eq("client_token", data.clientToken).maybeSingle();
      if (prior) return { sessionId: prior.id as string, reused: true };
    }
    const ids: string[] = [];
    if (data.sourcePostId) {
      // The source must belong to this space (checked as the caller, RLS + explicit space filter).
      const { data: src } = await supabase.from("source_posts").select("id").eq("id", data.sourcePostId).eq("space_id", data.spaceId).maybeSingle();
      if (!src) throw new Error("Link salvo não encontrado neste espaço.");
      ids.push(src.id);
    }
    for (const r of extractSocial([data.url, data.text, data.title].filter(Boolean).join("\n"), 12)) {
      // One source per space+post (shortcode reuse for legacy /p/ rows); first author kept.
      const { data: id, error } = await supabase.rpc("import_source_for", { _space: data.spaceId, _platform: r.platform === "instagram" ? "instagram" : "tiktok", _url: sourceUrl(r), _shortcode: r.platform === "instagram" ? r.id : null, _reel: r.platform === "instagram" && r.kind === "reel" } as never);
      if (error || !id) throw new Error("Não foi possível guardar o link.");
      if (!ids.includes(id as string)) ids.push(id as string);
    }
    const { data: s, error } = await db.from("import_sessions").insert({ space_id: data.spaceId, created_by: userId, origin: data.origin, shared_title: data.title ?? null, shared_text: data.text ?? null, shared_url: data.url ?? null, source_post_ids: ids, client_token: data.clientToken ?? null }).select("id").single();
    if (error?.code === "23505" && data.clientToken) {
      const { data: prior } = await db.from("import_sessions").select("id").eq("created_by", userId).eq("client_token", data.clientToken).maybeSingle();
      if (prior) return { sessionId: prior.id as string, reused: true };
    }
    if (error || !s) throw new Error("Não foi possível criar a sessão.");
    return { sessionId: s.id as string, reused: false };
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
    await refreshStatus(s.id);
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
      if (!needsCaptionFetch(p)) continue;
      const ref = extractSocial(p.source_url, 1)[0];
      if (!ref) continue;
      fetched++;
      const r = await fetchCaption(ref).catch(() => null);
      const patch = captionPatch(p, r);
      if (patch) {
        const { error } = await db.from("source_posts").update(patch).eq("id", p.id);
        if (error) throw new Error("Não foi possível guardar a legenda lida. Tente de novo.");
      }
    }
    return { fetched };
  });

/** Share Target: capture and recognize without a second tap. This is deliberately bounded to
 * three sources while the authenticated media worker is still being evaluated. */
export const autoAnalyzeSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ sessionId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const s = await ownSession(context.supabase, data.sessionId);
    if (s.status === "completed" || s.ai_done) return { ok: true as const, alreadyDone: true };
    if (s.origin !== "share") throw new Error("Análise automática disponível apenas para links compartilhados.");
    await setStatus(s.id, { status: "analyzing" });
    try {
      const recognize = async (text: string): Promise<Item[]> => {
        const guess = explicitTitle(text);
        if (guess) {
          const item = await findTitle(guess).catch(() => null);
          if (item) return [item];
        }
        const analysis = await runImportAnalysis({ supabase: context.supabase, userId: context.userId, spaceId: s.space_id, text });
        if (!analysis.ok) throw new Error(analysis.reason);
        return analysis.items;
      };
      const { data: posts, error } = await context.supabase.from("source_posts")
        .select("id, source_url, caption, caption_status, caption_fetched_at")
        .in("id", s.source_post_ids.length ? s.source_post_ids : ["00000000-0000-0000-0000-000000000000"]);
      if (error) throw new Error("Não foi possível consultar os links.");
      const byId = new Map((posts ?? []).map((p) => [p.id, p]));
      const db = await admin();
      let found = 0;
      let sawCaption = false;
      for (const id of s.source_post_ids.slice(0, 3)) {
        const p = byId.get(id);
        if (!p) continue;
        let caption = p.caption;
        if (needsCaptionFetch(p)) {
          const ref = extractSocial(p.source_url, 1)[0];
          const result = ref ? await fetchCaption(ref).catch(() => null) : null;
          const patch = captionPatch(p, result);
          if (patch) {
            caption = patch.caption;
            const { error: updateError } = await db.from("source_posts").update(patch).eq("id", id);
            if (updateError) throw new Error("Não foi possível guardar a legenda.");
          }
        }
        if (!caption) continue;
        sawCaption = true;
        const items = await recognize(caption);
        if (items.length) await addCandidates(s.id, s.space_id, s.created_by, items, id);
        found += items.length;
      }
      const freeText = [s.shared_title, s.shared_text].filter(Boolean).join("\n").replace(/https?:\/\/\S+/g, " ").trim();
      if (freeText && !found) {
        const items = await recognize(freeText.slice(0, 4000));
        if (items.length) await addCandidates(s.id, s.space_id, s.created_by, items, s.source_post_ids.length === 1 ? s.source_post_ids[0]! : null);
        found += items.length;
      }
      if (!found && s.source_post_ids.length && !freeText && !sawCaption) {
        await refreshStatus(s.id);
        return { ok: false as const, reason: "Este post não trouxe descrição ou legenda pública. Confira o link recebido ou envie uma captura do vídeo." };
      }
      await setStatus(s.id, { ai_done: true,
        ...(s.source_post_ids.length > 3 ? { note: "A análise automática verificou os três primeiros links deste envio." } : {}),
      });
      await refreshStatus(s.id);
      return { ok: true as const, found };
    } catch (e) {
      await refreshStatus(s.id, "interrupted");
      return { ok: false as const, reason: e instanceof Error ? e.message : "A análise foi interrompida." };
    }
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

/** Confirm: ensure the TMDB-validated work, then one transactional RPC (indication, reaction, seen, source link, status).
 * Idempotent: a saved candidate returns its stored result. Works are never deleted on failure; the note says what may remain. */
export const confirmCandidate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ candidateId: z.string().uuid(), reaction: z.enum(["fire", "like", "neutral"]) }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: c } = await supabase.from("import_candidates").select("id, space_id, media_type, tmdb_id, seen, status, work_id").eq("id", data.candidateId).maybeSingle();
    if (!c) throw new Error("Candidato não encontrado.");
    if (c.status === "saved") return { status: "saved", indication: undefined, idempotent: true };
    if (c.status !== "pending" && c.status !== "error") throw new Error("Volte esta obra para pendente antes de confirmar.");
    const { data: before } = await supabase.from("works").select("id").eq("space_id", c.space_id).eq("media_type", c.media_type).eq("tmdb_id", c.tmdb_id).maybeSingle();
    let workId: string | null = before?.id ?? null;
    let note = "Não foi possível confirmar. Nada desta obra foi gravado; tente de novo.";
    try {
      if (!workId) workId = await ensureWork(supabase, userId, { spaceId: c.space_id, mediaType: c.media_type, tmdbId: c.tmdb_id });
      const { data: r, error } = await supabase.rpc("import_confirm", { _candidate: c.id, _work: workId, _reaction: data.reaction, _seen: c.seen });
      if (error) throw new Error(error.message);
      return r as { status: string; indication?: "created" | "renewed"; idempotent: boolean };
    } catch (e) {
      // No automatic deletion: there is no reliable proof this call alone created the work, and keeping an
      // unreferenced catalog row is safer than deleting someone's earlier work.
      if (!before && workId) note = "A obra pode ter ficado no catálogo do espaço, mas a indicação não foi gravada. Tente de novo.";
      const { error: ue } = await (await admin()).from("import_candidates").update({ status: "error", note, updated_at: new Date().toISOString() }).eq("id", c.id).in("status", ["pending", "error"]);
      if (ue) console.error("import: failed to mark candidate error", ue.message);
      const msg = e instanceof Error ? e.message : "";
      throw new Error(msg.startsWith("Não") ? msg : note);
    }
  });
