// Simkl AUTH V2 (OAuth 2.0 + PKCE S256), read-only (media:read). Server-only.
// Tokens live in private.simkl_tokens behind service-role definer functions; never returned to clients.
const API = "https://api.simkl.com";
const APP = "appcinema";
const VERSION = "1.0";
const UA = `${APP}/${VERSION}`;
export const SIMKL_ISSUER = "https://simkl.com";
export const AUTO_SYNC_MIN_MS = 20 * 60_000;
export const MANUAL_SYNC_MIN_MS = 60_000;

export function simklConfig() {
  const clientId = process.env["SIMKL_CLIENT_ID"];
  const clientSecret = process.env["SIMKL_CLIENT_SECRET"];
  const redirectUri = process.env["SIMKL_REDIRECT_URI"];
  return clientId && clientSecret && redirectUri ? { clientId, clientSecret, redirectUri } : null;
}
type Config = NonNullable<ReturnType<typeof simklConfig>>;

async function admin() {
  return (await import("@/integrations/supabase/client.server")).supabaseAdmin;
}

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const random = (n: number) => b64url(crypto.getRandomValues(new Uint8Array(n)));

export async function buildAuthorizeUrl(cfg: Config, userId: string) {
  const verifier = random(48); // 64 chars
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
  const state = random(24);
  const { error } = await (await admin()).rpc("simkl_state_put", { _state: state, _user: userId, _verifier: verifier });
  if (error) throw new Error("Não foi possível iniciar a conexão.");
  const u = new URL("https://simkl.com/oauth2/authorize");
  u.search = new URLSearchParams({ client_id: cfg.clientId, redirect_uri: cfg.redirectUri, response_type: "code", scope: "media:read", state, code_challenge: challenge, code_challenge_method: "S256" }).toString();
  return u.toString();
}

/** Single-use, expiring state bound to the user who started the flow. */
export async function takeState(state: string) {
  const { data } = await (await admin()).rpc("simkl_state_take", { _state: state });
  const row = Array.isArray(data) ? data[0] : null;
  return row?.user_id && row.verifier ? { userId: row.user_id as string, verifier: row.verifier as string } : null;
}

type TokenResponse = { access_token: string; refresh_token?: string; expires_in: number; scope?: string };
async function tokenRequest(cfg: Config, body: Record<string, string>) {
  const res = await fetch(`${API}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": UA, Authorization: `Basic ${btoa(`${cfg.clientId}:${cfg.clientSecret}`)}` },
    body: new URLSearchParams(body).toString(),
  });
  if (!res.ok) throw new Error(`token_${res.status}`); // never log body (may echo grant data)
  return (await res.json()) as TokenResponse;
}

async function saveToken(userId: string, t: TokenResponse, previousRefresh?: string) {
  const refresh = t.refresh_token ?? previousRefresh;
  if (!refresh) throw new Error("token_without_refresh");
  const { error } = await (await admin()).rpc("simkl_token_set", { _user: userId, _access: t.access_token, _refresh: refresh, _expires: new Date(Date.now() + t.expires_in * 1000).toISOString(), _scope: t.scope ?? "media:read" });
  if (error) throw new Error("token_store_failed");
}

/** Code exchange happens once: Simkl burns the code even on failure, so no retry. */
export async function exchangeCode(cfg: Config, userId: string, code: string, verifier: string) {
  const t = await tokenRequest(cfg, { grant_type: "authorization_code", code, redirect_uri: cfg.redirectUri, code_verifier: verifier });
  await saveToken(userId, t);
  const settings = await api<{ user?: { name?: string }; account?: { id?: number } }>(cfg, t.access_token, "/users/settings", "POST").catch(() => null);
  await setAccount(userId, { status: "connected", external_account_id: settings?.account?.id ? String(settings.account.id) : null, external_username: settings?.user?.name ?? null, sync_status: "never", sync_error: null });
}

export async function setAccount(userId: string, patch: Record<string, unknown>) {
  await (await admin()).from("integration_accounts").upsert({ user_id: userId, provider: "simkl", updated_at: new Date().toISOString(), status: "connected", ...patch }, { onConflict: "user_id,provider" });
}

async function getToken(cfg: Config, userId: string) {
  const { data } = await (await admin()).rpc("simkl_token_get", { _user: userId });
  const row = Array.isArray(data) ? data[0] : null;
  if (!row) return null;
  // Single owner refresh: only when ~1 day from expiry (Simkl refresh replaces the live access token).
  if (new Date(row.expires_at).getTime() - Date.now() < 86_400_000) {
    const t = await tokenRequest(cfg, { grant_type: "refresh_token", refresh_token: row.refresh_token });
    await saveToken(userId, t, row.refresh_token);
    return { ...row, access_token: t.access_token };
  }
  return row;
}

async function api<T>(cfg: Config, token: string, path: string, method: "GET" | "POST" = "GET", params: Record<string, string> = {}): Promise<T> {
  const u = new URL(API + path);
  u.search = new URLSearchParams({ client_id: cfg.clientId, "app-name": APP, "app-version": VERSION, ...params }).toString();
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(u, { method, headers: { "User-Agent": UA, Authorization: `Bearer ${token}`, "Content-Type": "application/json" } });
    if (res.status === 429 && attempt < 2) {
      const wait = Math.min(8, Number(res.headers.get("Retry-After")) || 2 * (attempt + 1));
      await new Promise((r) => setTimeout(r, wait * 1000));
      continue;
    }
    if (res.status === 429) throw new Error("rate_limited");
    if (res.status === 401) throw new Error("unauthorized");
    if (!res.ok) throw new Error(`simkl_${res.status}`);
    const text = await res.text();
    return (text ? JSON.parse(text) : null) as T;
  }
  throw new Error("rate_limited");
}

type Ids = { simkl?: number; tmdb?: string | number; imdb?: string };
type Entry = {
  show?: { title?: string; year?: number; ids?: Ids }; movie?: { title?: string; year?: number; ids?: Ids };
  status?: string; last_watched_at?: string | null; watched_episodes_count?: number; total_episodes_count?: number; user_rating?: number | null;
  seasons?: { number: number; episodes?: { number: number; watched_at?: string | null }[] }[]; episodes?: { number: number; watched_at?: string | null }[];
};
type AllItems = { shows?: Entry[]; movies?: Entry[]; anime?: Entry[] } | null;

function toRows(userId: string, payload: AllItems) {
  const rows: Record<string, unknown>[] = [];
  for (const [type, list] of [["shows", payload?.shows], ["movies", payload?.movies], ["anime", payload?.anime]] as const) {
    for (const e of list ?? []) {
      const m = e.movie ?? e.show;
      const simklId = m?.ids?.simkl;
      if (!m || !simklId) continue;
      // include_all_episodes=original: only episodes the user recorded, each with its real date.
      const eps = [...(e.seasons ?? []).flatMap((s) => (s.episodes ?? []).map((ep) => ({ s: s.number, e: ep.number, at: ep.watched_at ?? null }))), ...(e.episodes ?? []).map((ep) => ({ s: null, e: ep.number, at: ep.watched_at ?? null }))];
      const tmdb = Number(m.ids?.tmdb);
      rows.push({
        user_id: userId, provider: "simkl", external_type: type, external_id: String(simklId),
        media_type: type === "movies" ? "movie" : "tv", tmdb_id: Number.isFinite(tmdb) && tmdb > 0 ? tmdb : null, imdb_id: m.ids?.imdb ?? null,
        title: m.title ?? "Sem título", year: m.year ?? null, status: e.status ?? null, last_watched_at: e.last_watched_at ?? null,
        watched_episodes_count: e.watched_episodes_count ?? null, total_episodes_count: e.total_episodes_count ?? null,
        dated_episodes_count: eps.filter((x) => x.at).length, user_rating: e.user_rating ?? null, episodes: eps.slice(0, 2000), synced_at: new Date().toISOString(),
      });
    }
  }
  return rows;
}

async function upsertRows(rows: Record<string, unknown>[]) {
  const db = await admin();
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await db.from("external_watch_items").upsert(rows.slice(i, i + 200), { onConflict: "user_id,provider,external_type,external_id" });
    if (error) throw new Error("store_failed");
  }
}

const FULL = { extended: "full", episode_watched_at: "yes", include_all_episodes: "original" };

/** Phase 1 (no snapshot): activities → shows → movies → anime sequential, snapshot only after all succeed. Phase 2: deltas by date_from + deletion diff. Never writes to Simkl. */
export async function runSync(cfg: Config, userId: string, manual: boolean) {
  const tok = await getToken(cfg, userId);
  if (!tok) return { ok: false as const, reason: "not_connected" };
  const since = tok.last_sync_at ? Date.now() - new Date(tok.last_sync_at).getTime() : Infinity;
  if (since < (manual ? MANUAL_SYNC_MIN_MS : AUTO_SYNC_MIN_MS)) return { ok: true as const, skipped: true };
  await (await admin()).rpc("simkl_sync_mark", { _user: userId, _snapshot: null, _attempt: true });
  await setAccount(userId, { sync_status: "syncing", sync_error: null });
  try {
    const activities = await api<{ all?: string }>(cfg, tok.access_token, "/sync/activities");
    const snapshot = tok.snapshot as { all?: string } | null;
    let changed = 0;
    if (!snapshot?.all) {
      for (const type of ["shows", "movies", "anime"] as const) {
        const data = await api<AllItems>(cfg, tok.access_token, `/sync/all-items/${type}`, "GET", FULL);
        const rows = toRows(userId, data);
        await upsertRows(rows);
        changed += rows.length;
      }
    } else if (activities?.all && activities.all !== snapshot.all) {
      const data = await api<AllItems>(cfg, tok.access_token, "/sync/all-items", "GET", { ...FULL, date_from: snapshot.all });
      const rows = toRows(userId, data);
      await upsertRows(rows);
      changed = rows.length;
      // Deletion reconciliation: drop local rows whose Simkl id is no longer in the library.
      const ids = await api<AllItems>(cfg, tok.access_token, "/sync/all-items", "GET", { extended: "simkl_ids_only" });
      const db = await admin();
      for (const type of ["shows", "movies", "anime"] as const) {
        const keep = new Set((ids?.[type] ?? []).map((e) => String((e.movie ?? e.show)?.ids?.simkl)));
        const { data: local } = await db.from("external_watch_items").select("id, external_id").eq("user_id", userId).eq("provider", "simkl").eq("external_type", type);
        const gone = (local ?? []).filter((r) => !keep.has(r.external_id)).map((r) => r.id);
        if (gone.length) await db.from("external_watch_items").delete().in("id", gone);
      }
    }
    await (await admin()).rpc("simkl_sync_mark", { _user: userId, _snapshot: activities ?? null, _attempt: false });
    await setAccount(userId, { sync_status: "ok", sync_error: null, last_sync_at: new Date().toISOString() });
    return { ok: true as const, skipped: false, changed };
  } catch (e) {
    const code = e instanceof Error ? e.message : "error";
    const msg = code === "rate_limited" ? "Simkl limitou as requisições; tente mais tarde." : code === "unauthorized" ? "Acesso ao Simkl expirou ou foi revogado; conecte de novo." : "Falha ao sincronizar com o Simkl.";
    await setAccount(userId, { sync_status: "error", sync_error: msg, ...(code === "unauthorized" ? { status: "reauth_required" } : {}) });
    return { ok: false as const, reason: msg };
  }
}

export async function disconnect(cfg: Config | null, userId: string) {
  const db = await admin();
  const { data } = await db.rpc("simkl_token_get", { _user: userId });
  const row = Array.isArray(data) ? data[0] : null;
  if (cfg && row?.refresh_token) {
    // Revoke always answers 200 (RFC 7009); discard our copy regardless.
    await fetch(`${API}/oauth2/revoke`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": UA, Authorization: `Basic ${btoa(`${cfg.clientId}:${cfg.clientSecret}`)}` }, body: new URLSearchParams({ token: row.refresh_token }).toString() }).catch(() => null);
  }
  await db.rpc("simkl_token_delete", { _user: userId });
  await db.from("external_watch_items").delete().eq("user_id", userId).eq("provider", "simkl");
  await db.from("integration_accounts").delete().eq("user_id", userId).eq("provider", "simkl");
}
