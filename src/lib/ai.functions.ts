import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { AiUnavailable, geminiConfig, geminiJson, type AiTitleGuess } from "./gemini.server";
import { findTitle, type TmdbSearchItem } from "./tmdb.server";

const AI_MESSAGE: Record<string, string> = {
  not_configured: "Pesquisa inteligente não configurada (falta GEMINI_API_KEY).",
  rate_limited: "Limite de uso da IA atingido por agora. Use a busca normal.",
  failed: "A IA não respondeu. Use a busca normal.",
  bad_output: "A IA respondeu de forma inválida. Tente reformular.",
};

export const getAiStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => geminiConfig());

async function validate(
  guesses: AiTitleGuess[],
  spaceId: string,
  supabase: Parameters<typeof geminiJson>[0]["supabase"],
) {
  const found = await Promise.all(guesses.slice(0, 10).map((g) => findTitle(g).catch(() => null)));
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
    z.object({ query: z.string().min(3).max(300), spaceId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    try {
      const res = await geminiJson<{ items?: AiTitleGuess[] }>({
        supabase: context.supabase,
        userId: context.userId,
        feature: "smart_search",
        system: `Você ajuda um casal a encontrar filmes e séries a partir de descrições em linguagem natural (pt-BR). ${GUESS_SCHEMA_HINT}`,
        parts: [{ text: data.query }],
        cacheTtlHours: 72,
        cacheSeed: `q:${data.query.trim().toLowerCase()}`,
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
