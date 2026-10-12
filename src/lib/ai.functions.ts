import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { AiUnavailable, GEMINI_SECRET, geminiConfig, geminiJson, testGemini, type AiTitleGuess } from "./gemini.server";
import { findImportTitle, findSpokenTitle, findTitle, lookupTmdb, type TmdbSearchItem } from "./tmdb.server";

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
  match: (guess: AiTitleGuess) => Promise<TmdbSearchItem | null> = findTitle,
) {
  const found: (TmdbSearchItem | null)[] = [];
  for (let i = 0; i < Math.min(12, guesses.length); i += 4) found.push(...await Promise.all(guesses.slice(i, i + 4).map((g) => match(g).catch(() => null))));
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
    z.object({ query: z.string().min(3).max(300), spaceId: z.string().uuid(), kind: z.enum(["all", "movie", "tv"]).default("all"), page: z.number().int().min(1).max(5).default(1), exclude: z.array(z.object({title:z.string().max(200),tmdbId:z.number().int(),mediaType:z.enum(["movie","tv"])})).max(50).default([]) }).parse(d),
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
        parts: [{ text: `${query}\nTipo: ${data.kind}\nLote: ${data.page}. Traga outros candidatos reais; não repita estes títulos: ${data.exclude.map((w)=>w.title).join("; ")}` }],
        cacheTtlHours: 72,
        cacheSeed: `q4:${query}:${data.kind}:${data.page}`,
      });
      const interpreted = Date.now();
      const items = (await validate(res.items ?? [], data.spaceId, context.supabase)).filter((w) => (data.kind === "all" || w.mediaType === data.kind) && !data.exclude.some((old)=>old.tmdbId===w.tmdbId && old.mediaType===w.mediaType));
      return { ok: true as const, items, hasMore: items.length > 0 && data.page < 5, timings: { interpretMs: interpreted - began, validateMs: Date.now() - interpreted } };
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
  .handler(async ({ data, context }) => runImportAnalysis({ supabase: context.supabase, userId: context.userId, spaceId: data.spaceId, ...(data.text ? { text: data.text } : {}), ...(data.image ? { image: data.image } : {}) }));

async function sha256Hex(bytes: Uint8Array<ArrayBuffer>) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

type ImportGuess = AiTitleGuess & { mentionedTitle?: string | null; originalTitle?: string | null };

function groundedImportGuesses(items: ImportGuess[], text?: string, hasImage = false): ImportGuess[] {
  const normalize = (value: string) => ` ${value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()} `;
  const source = text ? normalize(text) : null;
  return items.slice(0, 10).filter((item) => {
    if (typeof item.title !== "string" || !item.title.trim()) return false;
    if (item.mediaType != null && item.mediaType !== "movie" && item.mediaType !== "tv") return false;
    if (!source) return true;
    if (typeof item.mentionedTitle === "string" && item.mentionedTitle.trim())
      return source.includes(normalize(item.mentionedTitle)) || hasImage;
    if (hasImage) return true;
    // A named film at the end of a transcript cannot be replaced by a plot-based guess.
    return !/\b(?:se chama|chamado|chamada|quatro filmes|cinco filmes|top cinco)\b/i.test(source);
  });
}

function mentionedListSize(text?: string) {
  const count = text?.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase()
    .match(/\b(?:top\s+)?(dois|tres|quatro|cinco|seis|sete|oito|nove|dez|[2-9]|10)\s+(?:filmes|series)\b/);
  const words: Record<string, number> = { dois: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10 };
  return count ? (words[count[1]!] ?? Number(count[1])) : null;
}

/** Server-side import analysis (explicit action only). Cache key = strategy version + content type + SHA-256 of the full text/image bytes. */
export async function runImportAnalysis(opts: { supabase: Parameters<typeof geminiJson>[0]["supabase"]; userId: string; spaceId: string; text?: string; image?: { mimeType: "image/png" | "image/jpeg" | "image/webp"; base64: string } }) {
  try {
    const textHash = opts.text ? await sha256Hex(new TextEncoder().encode(opts.text)) : "-";
    const imageHash = opts.image ? await sha256Hex(Uint8Array.from(atob(opts.image.base64), (ch) => ch.charCodeAt(0))) : "-";
    const parts = [
      ...(opts.text ? [{ text: opts.text }] : []),
      ...(opts.image ? [{ inline_data: { mime_type: opts.image.mimeType, data: opts.image.base64 } }] : []),
    ];
    const res = await geminiJson<{ items?: ImportGuess[] }>({
      supabase: opts.supabase,
      userId: opts.userId,
      feature: "import",
      system: `Identifique filmes e séries a partir da descrição, fala legendada ou imagem (pt-BR). Leia TODA a evidência, inclusive o fim. Se houver imagem, LEIA os títulos escritos nela literalmente e dê prioridade a esses nomes quando a transcrição automática da fala discordar; "mentionedTitle" deve ser o nome visível na imagem. Para listas, extraia cada título citado na ordem em que aparece: se a fala disser "quatro filmes" ou "top cinco", procure os quatro ou cinco nomes, sem saltar nenhum. Não inclua outra obra para preencher a quantidade. Sem imagem, quando houver nome falado, "mentionedTitle" deve reproduzir SOMENTE as palavras exatas desse nome na evidência, inclusive erros da transcrição automática (ex.: "underton"); "title" deve ser o título real da obra e "originalTitle" o título original real quando tiver certeza. Não substitua um filme nomeado por outro que se encaixe na descrição. Se um filme não for nomeado, use mentionedTitle:null e identifique-o só quando o enredo/elenco/direção permitirem alta confiança sem conflito com nenhum nome falado. Ano: null quando não souber; não presuma ano de lançamento pela data do vídeo. Responda só JSON {"items":[{"title":string,"originalTitle":string|null,"mentionedTitle":string|null,"year":number|null,"mediaType":"movie"|"tv"|null}]}. Máximo 10 obras distintas.`,
      parts,
      cacheTtlHours: 24 * 14,
      cacheSeed: `import-v5:${opts.text ? "t" : ""}${opts.image ? `i:${opts.image.mimeType}` : ""}:${textHash}:${imageHash}`,
    });
    const match = (guess: AiTitleGuess) => findImportTitle(guess as ImportGuess);
    const guesses = groundedImportGuesses(Array.isArray(res.items) ? res.items : [], opts.text, !!opts.image);
    let items = await validate(guesses, opts.spaceId, opts.supabase, match);
    const expected = mentionedListSize(opts.text);
    if (!items.length && !expected && opts.text) {
      const spoken = await findSpokenTitle(opts.text).catch(() => null);
      if (spoken) items = await validate([{ title: spoken.title, mediaType: spoken.mediaType }], opts.spaceId, opts.supabase, async () => spoken);
    }
    if (expected && items.length < expected) {
      // One bounded recovery pass: ask only for names still missing from an explicit list.
      try {
        const recovery = await geminiJson<{ items?: ImportGuess[] }>({
          supabase: opts.supabase,
          userId: opts.userId,
          feature: "import",
          system: `Extraia SOMENTE os títulos que faltam desta lista de ${expected} filmes/séries. Leia a fala inteira e, se houver imagem, prefira os nomes escritos nela em caso de divergência com a legenda automática. Não repita os títulos já identificados; se não conseguir verificar o nome, retorne menos itens. Responda apenas JSON {"items":[{"title":string,"originalTitle":string|null,"mentionedTitle":string|null,"year":number|null,"mediaType":"movie"|"tv"|null}]}. mentionedTitle deve ser o nome exato visível ou falado; ano null se não for certo. Nunca substitua um nome mencionado por filme de enredo parecido.`,
          parts: [{ text: `${opts.text ?? ""}\n\nTítulos já identificados no catálogo: ${items.map((item) => `${item.title} / ${item.originalTitle ?? ""}`).join("; ")}` }, ...(opts.image ? [{ inline_data: { mime_type: opts.image.mimeType, data: opts.image.base64 } }] : [])],
          cacheTtlHours: 24 * 14,
          cacheSeed: `import-v5-recovery:${textHash}:${imageHash}:${items.map((item) => item.tmdbId).join(",")}`,
        });
        const additional = groundedImportGuesses(Array.isArray(recovery.items) ? recovery.items : [], opts.text, !!opts.image);
        if (additional.length) {
          const more = await validate(additional, opts.spaceId, opts.supabase, match);
          const seen = new Set(items.map((item) => `${item.mediaType}:${item.tmdbId}`));
          items = [...items, ...more.filter((item) => !seen.has(`${item.mediaType}:${item.tmdbId}`))].slice(0, 10);
        }
      } catch (error) {
        console.warn("Import list recovery unavailable:", error instanceof Error ? error.name : "error");
      }
    }
    return { ok: true as const, items };
  } catch (e) {
    if (e instanceof AiUnavailable) return { ok: false as const, reason: AI_MESSAGE[e.message] ?? AI_MESSAGE["failed"]!, items: [] };
    throw e;
  }
}

/**
 * refineMatch: Resolves internal candidates via search-ranking (local) and discovers external ones via AI.
 * External-only AI without internal IDs: Gemini only receives titles to find new suggestions.
 */
export const refineMatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ spaceId: z.string().uuid(), ids: z.array(z.string().uuid()).max(40), query: z.string().min(3).max(180), kind: z.enum(["all", "movie", "tv"]) }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = data.ids.length ? await context.supabase.from("works").select("id,tmdb_id,media_type,title,runtime_minutes,genres,interests(reaction),indications(id)").eq("space_id",data.spaceId).in("id",data.ids) : {data:[],error:null};
    if (error) throw new Error("Não foi possível preparar candidatos.");
    const intent=data.query.trim().replace(/\s+/g," ").toLowerCase();
    const signals=intentSignals(intent);
    const genreOk=(genres:string[])=>!signals.genres.length || signals.genres.some(g=>genres.includes(g));
    let eligible = (rows ?? []).filter(w=>w.indications.length && !w.interests.some(i=>i.reaction === "dislike") && (data.kind === "all" || w.media_type === data.kind) && genreOk(w.genres));
    // Explicit origin: genre alone never proves country. Verify original_language on TMDB
    // for at most 16 internals (4 at a time); unverified ones are omitted.
    if(signals.languages.length){
      const pick=eligible.slice(0,16), ok=new Set<string>();
      for(let i=0;i<pick.length;i+=4) await Promise.all(pick.slice(i,i+4).map(async w=>{const t=await lookupTmdb(w.media_type as "movie"|"tv",w.tmdb_id).catch(()=>null); if(t && signals.languages.includes(t.originalLanguage ?? "")) ok.add(w.id);}));
      eligible=pick.filter(w=>ok.has(w.id));
    }
    const strict=signals.languages.length>0 || signals.genres.length>0;
    // With canonical intent signals, an incompatible internal title never returns as fallback.
    const fallback=eligible.map(w=>w.id);
    try {
      const {data:library} = await context.supabase.from("works").select("title,media_type").eq("space_id",data.spaceId).limit(100);
      const compact=eligible.map((w,index)=>({index,title:w.title,type:w.media_type,minutes:w.runtime_minutes,genres:w.genres.slice(0,3)}));
      const result=await geminiJson<{order?:number[];items?:AiTitleGuess[]}>({supabase:context.supabase,userId:context.userId,feature:"smart_search",system:'Refine os candidatos pela intenção, incluindo origem/idioma, gênero e formato. Retorne JSON {"order":[índices compatíveis em ordem],"items":[{"title":string,"year":number|null,"mediaType":"movie"|"tv"}]}. order só índices fornecidos e realmente compatíveis, nunca IDs. items: 12 títulos reais novos ainda fora da biblioteca, compatíveis com intenção e tipo, MESMO quando não há candidatos internos. Origem (ex.: coreano, japonês) significa produção/idioma original desse país; gênero deve ser o gênero principal. Não invente metadados, votos ou resultados.',parts:[{text:JSON.stringify({intent,kind:data.kind,library:library ?? [],candidates:compact})}],cacheTtlHours:24,cacheSeed:`match-intent-v4:${data.kind}:${intent}:${JSON.stringify(compact)}`});
      const ids=[...new Set(result.order ?? [])].filter(i=>Number.isInteger(i) && i>=0 && i<eligible.length).flatMap(i=>eligible[i] ? [eligible[i].id] : []);
      const external=(await validate((result.items ?? []).slice(0,12),data.spaceId,context.supabase)).filter(w=>!w.existingWorkId && (data.kind === "all" || w.mediaType === data.kind) && genreOk(w.genres ?? []) && (!signals.languages.length || signals.languages.includes(w.originalLanguage ?? ""))).slice(0,12);
      // AI answered: its compatible subset is authoritative (possibly empty) when intent is explicit.
      return {ids:strict || ids.length || external.length ? ids : fallback,external,refined:true,strict,reason:null};
    } catch {return {ids:fallback,external:[],refined:false,strict,reason:"IA indisponível · o Match normal continua disponível."};}
  });

const ORIGINS:[RegExp,string[]][]=[[/corean|coreia|k-?drama/,["ko"]],[/japon|japão|anime|j-?horror/,["ja"]],[/iran/,["fa"]],[/franc[eê]s|fran[çc]a/,["fr"]],[/espanh/,["es"]],[/brasil|nacional/,["pt"]],[/indian|bollywood/,["hi","ta","te"]],[/chin[eê]s|china/,["zh","cn"]],[/italian/,["it"]],[/alem[aã]/,["de"]],[/tailand/,["th"]],[/turc/,["tr"]]];
const GENRE_WORDS:[RegExp,string[]][]=[[/terror|horror/,["Terror"]],[/com[eé]dia|engra[çc]ad/,["Comédia"]],[/romanc|rom[aâ]ntic/,["Romance"]],[/a[çc][aã]o\b/,["Ação","Ação e Aventura"]],[/fic[çc][aã]o cient|sci-?fi/,["Ficção científica","Sci-Fi e Fantasia"]],[/anima[çc]/,["Animação"]],[/suspense|thriller/,["Thriller","Mistério"]],[/document/,["Documentário"]],[/crime|policial/,["Crime"]],[/fantasia/,["Fantasia","Sci-Fi e Fantasia"]],[/guerra/,["Guerra","Guerra e Política"]]];
/** Canonical TMDB signals (original_language + genre names) derived from explicit intent words. */
function intentSignals(intent:string){
  const languages=ORIGINS.filter(([r])=>r.test(intent)).flatMap(([,l])=>l);
  const genres=GENRE_WORDS.filter(([r])=>r.test(intent)).flatMap(([,g])=>g);
  // Horror series on TMDB often only carry Mystery/Sci-Fi; allow those for TV terror.
  if(genres.includes("Terror")) genres.push("Mistério","Sci-Fi e Fantasia");
  return {languages,genres};
}
