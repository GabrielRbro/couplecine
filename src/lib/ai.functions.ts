import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { AiUnavailable, GEMINI_SECRET, geminiConfig, geminiJson, testGemini, type AiTitleGuess } from "./gemini.server";
import { findTitle, type TmdbSearchItem } from "./tmdb.server";

const AI_MESSAGE: Record<string, string> = {
  not_configured: "Pesquisa inteligente não configurada. Adicione a chave do Gemini em Configurações.",
  rate_limited: "Limite de uso da IA atingido por agora. Use a busca normal.",
  failed: "A IA não respondeu. Use a busca normal.",
  bad_output: "A IA respondeu de forma inválida. Tente reformular.",
};

type Ctx = { supabase: Parameters<typeof geminiJson>[0]["supabase"] };
async function isOwner(ctx: Ctx) {
  const { data, error } = await ctx.supabase.rpc("can_create_space");
  return !error && data === true;
}
async function requireOwner(ctx: Ctx) {
  if (!(await isOwner(ctx))) throw new Error("Só o dono do espaço pode alterar a chave do Gemini.");
}

export const getAiStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const [cfg, owner] = await Promise.all([geminiConfig(), isOwner(context)]);
    // Partner sees only on/off; the owner also sees source and last 4 chars.
    return {
      configured: cfg.configured,
      model: cfg.model,
      isOwner: owner,
      source: owner ? cfg.source : null,
      last4: owner ? cfg.last4 : null,
    };
  });

const keySchema = z.object({ key: z.string().trim().min(20).max(200) });

export const testGeminiKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => keySchema.parse(d))
  .handler(async ({ data, context }) => {
    await requireOwner(context);
    return { result: await testGemini(data.key) };
  });

export const saveGeminiKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => keySchema.parse(d))
  .handler(async ({ data, context }) => {
    await requireOwner(context);
    const result = await testGemini(data.key);
    if (result === "invalid_key") return { ok: false as const, result };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.rpc("app_secret_set", {
      _name: GEMINI_SECRET,
      _value: data.key,
      _by: context.userId,
    });
    if (error) {
      console.error("app_secret_set failed:", error.code);
      throw new Error("Não foi possível salvar a chave.");
    }
    return { ok: true as const, result };
  });

export const removeGeminiKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireOwner(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.rpc("app_secret_delete", { _name: GEMINI_SECRET });
    if (error) throw new Error("Não foi possível remover a chave.");
    return { ok: true };
  });

async function validate(
  guesses: AiTitleGuess[],
  spaceId: string,
  supabase: Parameters<typeof geminiJson>[0]["supabase"],
) {
  const found: (TmdbSearchItem | null)[] = [];
  for (let i = 0; i < Math.min(10, guesses.length); i += 4) found.push(...await Promise.all(guesses.slice(i, i + 4).map((g) => findTitle(g).catch(() => null))));
  const { data: existing } = await supabase
    .from("works")
    .select("id, media_type, tmdb_id")
    .eq("space_id", spaceId);
  const map = new Map((existing ?? []).map((w) => [`${w.media_type}:${w.tmdb_id}`, w.id]));
  const seen = new Set<string>();
  const out: (TmdbSearchItem & { existingWorkId: string | null })[] = [];
  for (const f of found) {
    if (!f) continue;
    const k = `${f.mediaType}:${f.tmdbId}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ ...f, existingWorkId: map.get(k) ?? null });
  }
  return out;
}

const GUESS_SCHEMA_HINT =
  'Responda só JSON: {"items":[{"title":string,"year":number|null,"mediaType":"movie"|"tv"|null}]}. Máximo 10 itens. Use títulos reais; prefira o título original quando souber.';

/** Explicit natural-language search: Gemini proposes titles, TMDB validates every one. */
export const smartSearch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({ query: z.string().min(3).max(300), spaceId: z.string().uuid(), kind: z.enum(["all", "movie", "tv"]).default("all") }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const began = Date.now();
    const query = data.query.trim().replace(/\s+/g, " ").toLowerCase();
    try {
      const res = await geminiJson<{ items?: AiTitleGuess[] }>({
        supabase: context.supabase,
        userId: context.userId,
        feature: "smart_search",
        system: `Você ajuda um casal a encontrar filmes e séries a partir de descrições em linguagem natural (pt-BR). ${GUESS_SCHEMA_HINT}`,
        parts: [{ text: `${query}\nTipo: ${data.kind}` }],
        cacheTtlHours: 72,
        cacheSeed: `q3:${query}:${data.kind}`,
      });
      const interpreted = Date.now();
      const items = (await validate(res.items ?? [], data.spaceId, context.supabase)).filter((w) => data.kind === "all" || w.mediaType === data.kind);
      return { ok: true as const, items, timings: { interpretMs: interpreted - began, validateMs: Date.now() - interpreted } };
    } catch (e) {
      if (e instanceof AiUnavailable)
        return {
          ok: false as const,
          reason: AI_MESSAGE[e.message] ?? AI_MESSAGE["failed"]!,
          items: [],
        };
      throw e;
    }
  });

/**
 * Import analysis (provider for Importações): text or an image/screenshot the backend actually received.
 * Returns TMDB-validated candidates for mandatory human review; nothing is saved here.
 */
export const analyzeImport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        spaceId: z.string().uuid(),
        text: z.string().max(4000).optional(),
        image: z
          .object({
            mimeType: z.enum(["image/png", "image/jpeg", "image/webp"]),
            base64: z.string().max(6_000_000),
          })
          .optional(),
      })
      .refine((v) => v.text || v.image, "Envie texto ou imagem.")
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    try {
      const parts = [
        ...(data.text ? [{ text: data.text }] : []),
        ...(data.image
          ? [{ inline_data: { mime_type: data.image.mimeType, data: data.image.base64 } }]
          : []),
      ];
      const res = await geminiJson<{ items?: AiTitleGuess[] }>({
        supabase: context.supabase,
        userId: context.userId,
        feature: "import",
        system: `Extraia apenas filmes e séries realmente citados ou mostrados no conteúdo recebido (texto, legenda ou captura de tela). Não invente. ${GUESS_SCHEMA_HINT}`,
        parts,
        cacheTtlHours: 24 * 14,
        cacheSeed: `i:${data.text ?? ""}:${data.image?.base64.slice(0, 2000) ?? ""}:${data.image?.base64.length ?? 0}`,
      });
      return {
        ok: true as const,
        items: await validate(res.items ?? [], data.spaceId, context.supabase),
      };
    } catch (e) {
      if (e instanceof AiUnavailable)
        return {
          ok: false as const,
          reason: AI_MESSAGE[e.message] ?? AI_MESSAGE["failed"]!,
          items: [],
        };
      throw e;
    }
  });

/** Optional preparation only: reads the caller's eligible library, never votes or results. */
export const refineMatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ spaceId: z.string().uuid(), ids: z.array(z.string().uuid()).max(40), query: z.string().min(3).max(180), kind: z.enum(["all", "movie", "tv"]) }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase.from("works").select("id,tmdb_id,media_type,title,runtime_minutes,genres,interests(reaction),indications(id)").eq("space_id",data.spaceId).in("id",data.ids);
    if (error) throw new Error("Não foi possível preparar candidatos.");
    const eligible = (rows ?? []).filter((w) => w.indications.length && !w.interests.some((i) => i.reaction === "dislike") && (data.kind === "all" || w.media_type === data.kind));
    const fallback = eligible.map((w) => w.id);
    try {
      const compact = eligible.map((w) => ({ id:w.id,title:w.title,type:w.media_type,minutes:w.runtime_minutes,genres:w.genres.slice(0,3) }));
      const result = await geminiJson<{ ids?: string[] }>({ supabase: context.supabase,userId:context.userId,feature:"smart_search",system:'Refine o conjunto de filmes/séries fornecido para a intenção. Retorne JSON {"ids":[ids]} em ordem de preferência; nunca invente ids, votos ou resultados. Mantenha pelo menos 2 candidatos se disponíveis.',parts:[{text:JSON.stringify({intent:data.query.trim().replace(/\s+/g," "),candidates:compact})}],cacheTtlHours:24,cacheSeed:`match:${data.kind}:${data.query.trim().toLowerCase()}:${JSON.stringify(compact)}` });
      const ids = [...new Set(result.ids ?? [])].filter((id) => fallback.includes(id));
      return ids.length >= 2 ? { ids, refined:true, reason:null } : { ids:fallback,refined:false,reason:"Mantivemos o conjunto normal." };
    } catch { return { ids:fallback, refined:false, reason:"IA indisponível · o Match normal continua disponível." }; }
  });
