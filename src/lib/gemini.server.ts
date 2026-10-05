/**
 * Gemini adapter (server only). Key: GEMINI_API_KEY. Model: GEMINI_MODEL (default below).
 * No Google Search grounding. Calls are small, JSON-only, and every title is validated on TMDB by callers.
 * Rate guard per user/feature is configurable via GEMINI_LIMIT_IMPORT / _SMART_SEARCH / _DISCOVER (calls per hour).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export type AiFeature = "import" | "smart_search" | "discover";

const DEFAULT_MODEL = "gemini-3.5-flash-lite";
// Priority Importações > Pesquisa inteligente > Descobrir is expressed as higher default allowances.
const DEFAULT_LIMITS: Record<AiFeature, number> = { import: 30, smart_search: 20, discover: 6 };

export function geminiConfig() {
  const key = process.env["GEMINI_API_KEY"];
  return { configured: !!key, model: process.env["GEMINI_MODEL"] || DEFAULT_MODEL };
}

function limitFor(feature: AiFeature) {
  const raw = process.env[`GEMINI_LIMIT_${feature.toUpperCase()}`];
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_LIMITS[feature];
}

export class AiUnavailable extends Error {}

type Part = { text: string } | { inline_data: { mime_type: string; data: string } };

async function hash(text: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 40);
}

/** Calls Gemini with JSON output, using ai_cache for cache/dedupe and a per-hour rate guard. */
export async function geminiJson<T>(opts: {
  supabase: SupabaseClient<Database>;
  userId: string;
  feature: AiFeature;
  system: string;
  parts: Part[];
  cacheTtlHours: number;
  cacheSeed: string;
}): Promise<T> {
  const { configured, model } = geminiConfig();
  if (!configured) throw new AiUnavailable("not_configured");
  const cacheKey = await hash(`${model}|${opts.cacheSeed}`);
  const { data: hit } = await opts.supabase
    .from("ai_cache")
    .select("payload, created_at")
    .eq("user_id", opts.userId)
    .eq("feature", opts.feature)
    .eq("cache_key", cacheKey)
    .maybeSingle();
  if (hit && Date.now() - new Date(hit.created_at).getTime() < opts.cacheTtlHours * 3600_000)
    return hit.payload as T;

  const since = new Date(Date.now() - 3600_000).toISOString();
  const { count } = await opts.supabase
    .from("ai_cache")
    .select("id", { count: "exact", head: true })
    .eq("user_id", opts.userId)
    .eq("feature", opts.feature)
    .gte("created_at", since);
  if ((count ?? 0) >= limitFor(opts.feature)) throw new AiUnavailable("rate_limited");

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": process.env["GEMINI_API_KEY"]!,
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: opts.system }] },
        contents: [{ role: "user", parts: opts.parts }],
        generationConfig: {
          responseMimeType: "application/json",
          temperature: 0.4,
          maxOutputTokens: 2048,
        },
      }),
    },
  );
  if (!res.ok) {
    console.error(`Gemini ${model} failed [${res.status}]: ${(await res.text()).slice(0, 300)}`);
    throw new AiUnavailable(res.status === 429 ? "rate_limited" : "failed");
  }
  const body = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text = body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  let parsed: T;
  try {
    parsed = JSON.parse(text) as T;
  } catch {
    throw new AiUnavailable("bad_output");
  }
  await opts.supabase.from("ai_cache").upsert(
    {
      user_id: opts.userId,
      feature: opts.feature,
      cache_key: cacheKey,
      payload: parsed as never,
      created_at: new Date().toISOString(),
    },
    { onConflict: "user_id,feature,cache_key" },
  );
  return parsed;
}

export type AiTitleGuess = {
  title: string;
  year?: number | null;
  mediaType?: "movie" | "tv" | null;
};
