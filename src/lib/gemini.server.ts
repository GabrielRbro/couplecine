/**
 * Gemini adapter (server only). Key: GEMINI_API_KEY. Model: GEMINI_MODEL (default below).
 * No Google Search grounding. Calls are small, JSON-only, and every title is validated on TMDB by callers.
 * Rate guard per user/feature is configurable via GEMINI_LIMIT_IMPORT / _SMART_SEARCH / _DISCOVER (calls per hour).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export type AiFeature = "import" | "smart_search" | "discover";

const DEFAULT_MODEL = "gemini-3.5-flash-lite";
const DEFAULT_FALLBACK_MODEL = "gemini-3.1-flash-lite";
const PRIMARY_RETRY_DELAY_MS = 450;
// Priority Importações > Pesquisa inteligente > Descobrir is expressed as higher default allowances.
const DEFAULT_LIMITS: Record<AiFeature, number> = { import: 30, smart_search: 20, discover: 6 };

export const GEMINI_SECRET = "gemini_api_key";

export function geminiModel() {
  return process.env["GEMINI_MODEL"] || DEFAULT_MODEL;
}

/** Keeps a second compatible model available for short provider outages. */
export function geminiModels() {
  return [...new Set([geminiModel(), process.env["GEMINI_FALLBACK_MODEL"] || DEFAULT_FALLBACK_MODEL].filter(Boolean))];
}

/** Key resolution (server only): AppCinema-stored key > GEMINI_API_KEY env > none. Never logged. */
export async function resolveGeminiKey(): Promise<{ key: string | null; source: "app" | "environment" | "none" }> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin.rpc("app_secret_get", { _name: GEMINI_SECRET });
    if (error) console.warn("Gemini key lookup failed:", error.code);
    if (typeof data === "string" && data) return { key: data, source: "app" };
  } catch (e) {
    console.warn("Gemini key lookup unavailable:", e instanceof Error ? e.name : "error");
  }
  const env = process.env["GEMINI_API_KEY"];
  return env ? { key: env, source: "environment" } : { key: null, source: "none" };
}

export async function geminiConfig() {
  const { key, source } = await resolveGeminiKey();
  return { configured: !!key, model: geminiModel(), fallbackModel: geminiModels()[1] ?? null, source, last4: key ? key.slice(-4) : null };
}

/** Minimal real call to validate a key. Never stores it. */
export async function testGemini(key: string): Promise<"success" | "invalid_key" | "rate_limited" | "unavailable"> {
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(geminiModel())}:generateContent`,
      {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: "ok" }] }],
          generationConfig: { maxOutputTokens: 1 },
        }),
      },
    );
    if (res.ok) return "success";
    if (res.status === 429) return "rate_limited";
    if (res.status === 401 || res.status === 403) return "invalid_key";
    if (res.status === 400) {
      const body = await res.text();
      if (/API_KEY_INVALID|API key not valid/i.test(body)) return "invalid_key";
    }
    console.warn("Gemini test failed with status", res.status);
    return "unavailable";
  } catch {
    return "unavailable";
  }
}

function limitFor(feature: AiFeature) {
  const raw = process.env[`GEMINI_LIMIT_${feature.toUpperCase()}`];
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_LIMITS[feature];
}

export class AiUnavailable extends Error {}

type Part = { text: string } | { inline_data: { mime_type: string; data: string } };
type GeminiFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export function isTransientGeminiStatus(status: number) {
  return status === 408 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

function retryDelay(response: Response | null) {
  const retryAfter = Number(response?.headers.get("retry-after"));
  return Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1_000, 1_500) : PRIMARY_RETRY_DELAY_MS;
}

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Sends at most three provider requests for one already-reserved AI attempt:
 * primary model, one short retry for transient errors, then one fallback-model try.
 */
export async function requestGeminiContent(opts: {
  key: string;
  models: string[];
  payload: Record<string, unknown>;
  feature: AiFeature;
  fetcher?: GeminiFetch;
  wait?: (ms: number) => Promise<void>;
}): Promise<{ response: Response; model: string }> {
  const fetcher = opts.fetcher ?? fetch;
  const wait = opts.wait ?? pause;
  const models = opts.models.filter(Boolean);
  let lastStatus: number | "network" | null = null;

  for (const [modelIndex, model] of models.entries()) {
    const attempts = modelIndex === 0 ? 2 : 1;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      let response: Response | null = null;
      try {
        response = await fetcher(
          `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
          {
            method: "POST",
            headers: { "content-type": "application/json", "x-goog-api-key": opts.key },
            body: JSON.stringify(opts.payload),
          },
        );
      } catch {
        lastStatus = "network";
      }

      if (response?.ok) return { response, model };

      const status = response?.status ?? "network";
      lastStatus = status;
      if (status === 401 || status === 403) {
        console.error(JSON.stringify({ event: "gemini.request.failed", feature: opts.feature, model, status }));
        throw new AiUnavailable("provider_unauthorized");
      }

      const transient = status === "network" || isTransientGeminiStatus(status);
      if (!transient && status !== 404) {
        console.error(JSON.stringify({ event: "gemini.request.failed", feature: opts.feature, model, status }));
        throw new AiUnavailable("failed");
      }

      if (attempt + 1 < attempts) {
        const delayMs = retryDelay(response);
        console.warn(JSON.stringify({ event: "gemini.request.retry", feature: opts.feature, model, status, retry: attempt + 1, delayMs }));
        await wait(delayMs);
      } else if (modelIndex + 1 < models.length) {
        console.warn(JSON.stringify({ event: "gemini.request.fallback", feature: opts.feature, model, status, fallbackModel: models[modelIndex + 1] }));
      }
    }
  }

  console.error(JSON.stringify({ event: "gemini.request.failed", feature: opts.feature, models, status: lastStatus }));
  throw new AiUnavailable("temporarily_unavailable");
}

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
  const { key } = await resolveGeminiKey();
  const model = geminiModel();
  if (!key) throw new AiUnavailable("not_configured");
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

  // Cache miss only: reserve one real attempt atomically before the network call.
  // Failures and 429s keep their reservation; cache hits never consume.
  const { data: allowed, error: re } = await opts.supabase.rpc("ai_reserve", {
    _feature: opts.feature,
    _limit: limitFor(opts.feature),
  });
  if (re) console.warn("ai_reserve failed:", re.code);
  if (re || !allowed) throw new AiUnavailable("rate_limited");

  const { response: res, model: responseModel } = await requestGeminiContent({
    key,
    models: geminiModels(),
    feature: opts.feature,
    payload: {
      systemInstruction: { parts: [{ text: opts.system }] },
      contents: [{ role: "user", parts: opts.parts }],
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.4,
        maxOutputTokens: 2048,
      },
    },
  });
  const body = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text = body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  let parsed: T;
  try {
    parsed = JSON.parse(text) as T;
  } catch {
    console.error(JSON.stringify({ event: "gemini.response.invalid_json", feature: opts.feature, model: responseModel }));
    throw new AiUnavailable("bad_output");
  }
  const { error: ce } = await opts.supabase.from("ai_cache").upsert(
    {
      user_id: opts.userId,
      feature: opts.feature,
      cache_key: cacheKey,
      payload: parsed as never,
      created_at: new Date().toISOString(),
    },
    { onConflict: "user_id,feature,cache_key" },
  );
  if (ce) console.warn("ai_cache write failed:", ce.code);
  return parsed;
}

export type AiTitleGuess = {
  title: string;
  year?: number | null;
  mediaType?: "movie" | "tv" | null;
};
