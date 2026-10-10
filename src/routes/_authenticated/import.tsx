import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Check, ChevronLeft, ChevronRight, ImagePlus, LoaderCircle, Search, Sparkles, Trash2, Undo2, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/app/AppShell";
import { BackButton } from "@/components/app/ui";
import { Poster } from "@/components/app/MediaCard";
import { Button } from "@/components/ui/button";
import { searchCatalog } from "@/lib/catalog.functions";
import { analyzeSession, confirmCandidate, correctCandidate, createImportSession, fetchSessionCaptions, resolveSession } from "@/lib/import.functions";
import { parseSocial } from "@/lib/social-url";
import { tmdbImage } from "@/lib/format";
import { useSpace } from "@/lib/space";

const MAX_TEXT = 4000;
const MAX_IMAGE = 4 * 1024 * 1024;
const PAGE = 20;
type Img = { name: string; mimeType: "image/png" | "image/jpeg" | "image/webp"; base64: string };
// Captures are never stored; one picked on the entry screen is handed to its session in memory only.
const pendingImages = new Map<string, Img>();

type Reaction = "fire" | "like" | "neutral";
type Cand = { id: string; source_post_id: string | null; media_type: "movie" | "tv"; tmdb_id: number; title: string; original_title: string | null; year: number | null; poster_path: string | null; backdrop_path: string | null; status: "pending" | "skipped" | "saved" | "error"; reaction: Reaction | null; seen: boolean; corrected: boolean; work_id: string | null; effects: { indication?: "created" | "renewed" } | null; note: string | null };
type Source = { id: string; platform: string; source_url: string; caption: string | null; caption_status: string | null; caption_fetched_at: string | null };
const STATUS: Record<string, string> = { analyzing: "Analisando", review: "Em revisão", needs_help: "Precisa de ajuda", interrupted: "Interrompida", completed: "Concluída" };

export const Route = createFileRoute("/_authenticated/import")({
  head: () => ({
    meta: [
      { title: "Importar — AppCinema" },
      { name: "description", content: "Importe filmes e séries a partir de links, textos e capturas, revisando cada obra antes de indicar." },
      { property: "og:title", content: "Importar — AppCinema" },
      { property: "og:description", content: "Revise um a um os títulos encontrados antes de indicar." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  // Web Share Target (GET) sends title/text/url separately; captured into a session then cleared with replace.
  validateSearch: (s: Record<string, unknown>): { title?: string; text?: string; url?: string; session?: string } => ({
    ...(typeof s["title"] === "string" ? { title: s["title"].slice(0, 300) } : {}),
    ...(typeof s["text"] === "string" ? { text: s["text"].slice(0, MAX_TEXT) } : {}),
    ...(typeof s["url"] === "string" ? { url: s["url"].slice(0, 2000) } : {}),
    ...(typeof s["session"] === "string" && /^[0-9a-f-]{36}$/.test(s["session"]) ? { session: s["session"] } : {}),
  }),
  component: () => (
    <AppShell>
      <ImportPage />
    </AppShell>
  ),
});

function readImage(file: File | undefined, done: (img: Img) => void) {
  if (!file) return;
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) { toast.error("Use PNG, JPEG ou WebP."); return; }
  if (file.size > MAX_IMAGE) { toast.error("Imagem acima de 4 MB."); return; }
  const reader = new FileReader();
  reader.onload = () => done({ name: file.name, mimeType: file.type as Img["mimeType"], base64: String(reader.result).split(",")[1] ?? "" });
  reader.readAsDataURL(file);
}

function ImportPage() {
  const search = Route.useSearch();
  return search.session ? <SessionView key={search.session} id={search.session} /> : <EntryView />;
}

function useStartSession() {
  const { data: space } = useSpace();
  const navigate = Route.useNavigate();
  const create = useServerFn(createImportSession);
  const resolve = useServerFn(resolveSession);
  return async (input: { origin: "share" | "manual" | "capture"; title?: string; text?: string; url?: string; sourcePostId?: string; image?: Img | null }) => {
    if (!space?.spaceId) throw new Error("Sem espaço");
    const { image, ...rest } = input;
    const { sessionId } = await create({ data: { spaceId: space.spaceId, ...Object.fromEntries(Object.entries(rest).filter(([, v]) => v)) } as never });
    if (image) pendingImages.set(sessionId, image);
    await resolve({ data: { sessionId } }).catch(() => null); // deterministic only; failures stay retomáveis
    await navigate({ search: { session: sessionId }, replace: true });
  };
}

function EntryView() {
  const { data: space } = useSpace();
  const search = Route.useSearch();
  const start = useStartSession();
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [image, setImage] = useState<Img | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const shared = !!(search.title || search.text || search.url);
  const ran = useRef(false);

  useEffect(() => {
    if (!shared || !space?.spaceId || ran.current) return;
    ran.current = true;
    // Guard against StrictMode/reload double capture of the same share payload.
    const key = `share:${search.title ?? ""}|${search.text ?? ""}|${search.url ?? ""}`;
    const prior = sessionStorage.getItem(key);
    if (prior) { void Route.router?.navigate({ to: "/import", search: { session: prior }, replace: true }); return; }
    sessionStorage.setItem(key, "pending");
    start({ origin: "share", ...(search.title ? { title: search.title } : {}), ...(search.text ? { text: search.text } : {}), ...(search.url ? { url: search.url } : {}) }).catch(() => { sessionStorage.removeItem(key); toast.error("Não foi possível capturar o compartilhamento."); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [space?.spaceId]);

  const sessions = useQuery({
    queryKey: ["import-sessions", space?.userId],
    enabled: !!space?.userId,
    queryFn: async () => (await supabase.from("import_sessions").select("id, status, origin, shared_title, shared_text, shared_url, updated_at, import_candidates(status)").neq("status", "completed").order("updated_at", { ascending: false }).limit(10)).data ?? [],
  });
  const backlog = useInfiniteQuery({
    queryKey: ["source-backlog", space?.spaceId],
    enabled: !!space?.spaceId,
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      const { data, error } = await supabase.from("source_posts").select("id, platform, source_url, created_at, created_by, source_post_works(id)").eq("space_id", space!.spaceId!).order("created_at", { ascending: false }).range(pageParam, pageParam + PAGE - 1);
      if (error) throw error;
      return data ?? [];
    },
    getNextPageParam: (last, all) => (last.length === PAGE ? all.length * PAGE : undefined),
  });
  const pending = (backlog.data?.pages.flat() ?? []).filter((p) => !p.source_post_works?.length);

  async function begin(input: Parameters<typeof start>[0]) {
    setBusy(true);
    try { await start(input); } catch { toast.error("Não foi possível iniciar a importação."); setBusy(false); }
  }

  if (shared) return <main className="flex min-h-[60dvh] items-center justify-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="animate-spin" />Guardando o compartilhamento…</main>;

  return (
    <main className="mx-auto max-w-md px-4 pb-32 pt-[max(env(safe-area-inset-top),16px)]">
      <div className="flex items-center gap-2"><BackButton /><h1 className="text-xl font-semibold">Importar</h1></div>
      <p className="mt-2 text-sm text-muted-foreground">Cole links ou texto, ou envie uma captura. Tudo vira uma sessão que você pode retomar depois.</p>
      <textarea value={text} onChange={(e) => setText(e.target.value.slice(0, MAX_TEXT))} rows={5} placeholder="Links do Instagram/TikTok/TMDB/IMDb, legenda, lista de títulos…" aria-label="Link ou texto para importar" className="mt-4 w-full rounded-2xl border border-border bg-card p-3 text-sm outline-none focus:border-primary" />
      <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => { readImage(e.target.files?.[0], setImage); e.target.value = ""; }} />
      <div className="mt-2 flex items-center gap-2">
        <Button variant="secondary" className="min-h-11" onClick={() => fileRef.current?.click()}><ImagePlus />{image ? "Trocar captura" : "Escolher captura"}</Button>
        {image && <span className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground"><span className="truncate">{image.name}</span><Button variant="ghost" size="icon" aria-label="Remover captura" className="h-11 w-11" onClick={() => setImage(null)}><X className="h-4 w-4" /></Button></span>}
      </div>
      <Button className="mt-4 min-h-12 w-full" disabled={(!text.trim() && !image) || busy} onClick={() => begin({ origin: !text.trim() && image ? "capture" : "manual", ...(text.trim() ? { text } : {}), image })}>{busy ? <LoaderCircle className="animate-spin" /> : <Search />}Iniciar importação</Button>

      {(sessions.data?.length ?? 0) > 0 && (
        <section className="mt-6">
          <h2 className="text-sm font-semibold">Sessões em andamento</h2>
          <ul className="mt-2 space-y-1">{sessions.data!.map((s) => {
            const left = (s.import_candidates ?? []).filter((c) => c.status === "pending" || c.status === "error").length;
            return (
              <li key={s.id} className="flex items-center gap-2 rounded-xl border border-border px-3 py-1">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs">{s.shared_url || s.shared_title || s.shared_text || (s.origin === "capture" ? "Captura" : "Texto")}</p>
                  <p className="text-[11px] text-muted-foreground">{STATUS[s.status]} · {left} pendentes · {new Date(s.updated_at).toLocaleDateString("pt-BR")}</p>
                </div>
                <Button asChild variant="ghost" className="min-h-11 text-xs"><Link to="/import" search={{ session: s.id }}>Retomar</Link></Button>
              </li>
            );
          })}</ul>
        </section>
      )}

      {pending.length > 0 && (
        <section className="mt-6">
          <h2 className="text-sm font-semibold">Links salvos pendentes</h2>
          <ul className="mt-2 space-y-1">{pending.map((p) => (
            <li key={p.id} className="flex items-center gap-1 rounded-xl border border-border px-3 py-1">
              <div className="min-w-0 flex-1">
                <a href={p.source_url} target="_blank" rel="noopener noreferrer" className="block truncate text-xs text-primary underline-offset-2 hover:underline">{p.source_url}</a>
                <p className="text-[11px] text-muted-foreground">{p.platform === "instagram" ? "Instagram" : p.platform === "tiktok" ? "TikTok" : p.platform} · {new Date(p.created_at).toLocaleDateString("pt-BR")}{p.created_by === space?.userId ? "" : " · do parceiro"}</p>
              </div>
              <Button variant="ghost" className="min-h-11 shrink-0 text-xs" disabled={busy} onClick={() => begin({ origin: "manual", url: p.source_url, sourcePostId: p.id })}>Analisar</Button>
              {p.created_by === space?.userId && <Button variant="ghost" size="icon" aria-label="Remover link" className="h-11 w-11 shrink-0" onClick={async () => { const { error } = await supabase.from("source_posts").delete().eq("id", p.id); if (error) toast.error("Não foi possível remover."); void qc.invalidateQueries({ queryKey: ["source-backlog"] }); }}><Trash2 className="h-4 w-4" /></Button>}
            </li>
          ))}</ul>
          {backlog.hasNextPage && <Button variant="ghost" className="mt-2 min-h-11 w-full" disabled={backlog.isFetchingNextPage} onClick={() => backlog.fetchNextPage()}>Ver mais</Button>}
        </section>
      )}
    </main>
  );
}

function SessionView({ id }: { id: string }) {
  const { data: space } = useSpace();
  const navigate = Route.useNavigate();
  const qc = useQueryClient();
  const captionsFn = useServerFn(fetchSessionCaptions);
  const analyzeFn = useServerFn(analyzeSession);
  const [image, setImage] = useState<Img | null>(() => pendingImages.get(id) ?? null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const q = useQuery({
    queryKey: ["import-session", id],
    queryFn: async () => {
      const { data: s, error } = await supabase.from("import_sessions").select("*").eq("id", id).maybeSingle();
      if (error) throw error;
      if (!s) return null;
      const [{ data: sources }, { data: cands }] = await Promise.all([
        s.source_post_ids.length ? supabase.from("source_posts").select("id, platform, source_url, caption, caption_status, caption_fetched_at").in("id", s.source_post_ids) : Promise.resolve({ data: [] as Source[] }),
        supabase.from("import_candidates").select("*").eq("session_id", id).order("position"),
      ]);
      const list = (cands ?? []) as unknown as Cand[];
      // Library state per candidate: work exists vs. my own indication exists (different things).
      const ids = [...new Set(list.map((c) => c.tmdb_id))];
      const { data: works } = ids.length ? await supabase.from("works").select("id, media_type, tmdb_id, indications(indicated_by)").eq("space_id", s.space_id).in("tmdb_id", ids) : { data: [] };
      const lib = new Map((works ?? []).map((w) => [`${w.media_type}:${w.tmdb_id}`, { workId: w.id, mine: (w.indications ?? []).some((i) => i.indicated_by === space?.userId) }]));
      return { session: s, sources: (sources ?? []) as Source[], cands: list, lib };
    },
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ["import-session", id] });

  async function run(label: string, fn: () => Promise<{ ok?: boolean; reason?: string; found?: number } | unknown>) {
    setBusy(label);
    setNotice(null);
    try {
      const r = (await fn()) as { ok?: boolean; reason?: string; found?: number } | undefined;
      if (r && r.ok === false && r.reason) setNotice(r.reason);
      else if (r && r.found === 0) setNotice("Nenhum filme ou série reconhecível. Em listas, Reels e carrosséis, envie capturas das imagens.");
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Falhou. Tente de novo.");
    } finally {
      setBusy(null);
      void refresh();
    }
  }

  if (q.isLoading) return <main className="flex min-h-[60dvh] items-center justify-center"><LoaderCircle className="animate-spin text-muted-foreground" /></main>;
  if (!q.data) return <main className="mx-auto max-w-md px-4 pt-10 text-center text-sm text-muted-foreground">Sessão não encontrada.<Button asChild variant="ghost" className="mt-4 min-h-11 w-full"><Link to="/import" search={{}}>Voltar</Link></Button></main>;
  const { session: s, sources, cands, lib } = q.data;

  if (reviewing && cands.length) return <ReviewStack cands={cands} lib={lib} spaceId={s.space_id} sources={sources} onChanged={refresh} onBack={() => setReviewing(false)} onDone={async () => { const { data } = await supabase.rpc("import_complete", { _session: id }); void refresh(); if (data === "completed") { toast.success("Sessão concluída"); void qc.invalidateQueries({ queryKey: ["library", s.space_id] }); void navigate({ search: {}, replace: true }); } else toast("Ainda há obras pendentes ou com erro."); }} />;

  const freeText = [s.shared_title, s.shared_text].filter(Boolean).join("\n").replace(/https?:\/\/\S+/g, " ").replace(/\s+/g, " ").trim();
  const left = cands.filter((c) => c.status === "pending" || c.status === "error").length;
  const needCaption = sources.some((p) => !p.caption && (!p.caption_fetched_at || Date.now() - new Date(p.caption_fetched_at).getTime() > 6 * 3600_000));

  return (
    <main className="mx-auto max-w-md px-4 pb-32 pt-[max(env(safe-area-inset-top),16px)]">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" aria-label="Voltar" className="-ml-2 h-11 w-11" onClick={() => navigate({ search: {}, replace: true })}><ChevronLeft /></Button>
        <h1 className="text-xl font-semibold">Importação</h1>
        <span className="ml-auto rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">{STATUS[s.status]}</span>
      </div>

      {sources.map((p) => {
        const ref = parseSocial(p.source_url);
        const idx = ref?.platform === "instagram" ? ref.imgIndex : null;
        return (
          <div key={p.id} className="mt-3 rounded-2xl border border-border bg-card p-3">
            <p className="text-[11px] text-muted-foreground">Fonte: {p.platform === "instagram" ? (ref?.platform === "instagram" && ref.kind === "reel" ? "Instagram Reel" : "Instagram") : "TikTok"}</p>
            <a href={p.source_url} target="_blank" rel="noopener noreferrer" className="block truncate text-xs text-primary">{p.source_url}</a>
            {idx ? <p className="mt-1 text-xs text-primary">Imagem {idx} do carrossel. A imagem não é lida: envie a captura dessa imagem.</p> : null}
            {p.caption ? <p className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap rounded-xl bg-background/60 p-2 text-sm">{p.caption}</p>
              : p.caption_status ? <p role="status" className="mt-2 text-xs text-muted-foreground">{p.caption_status === "blocked" ? "A rede bloqueou a leitura pública. Envie uma captura ou cole a legenda." : "Legenda indisponível. Envie uma captura ou cole a legenda."}</p> : null}
            {p.caption && <Button variant="secondary" className="mt-2 min-h-11 w-full" disabled={!!busy} onClick={() => run(p.id, () => analyzeFn({ data: { sessionId: id, sourcePostId: p.id } }))}>{busy === p.id ? <LoaderCircle className="animate-spin" /> : <Sparkles />}Analisar legenda com IA</Button>}
          </div>
        );
      })}
      {needCaption && <Button variant="outline" className="mt-2 min-h-12 w-full" disabled={!!busy} onClick={() => run("cap", () => captionsFn({ data: { sessionId: id } }))}>{busy === "cap" ? <LoaderCircle className="animate-spin" /> : <Search />}Buscar legenda do post</Button>}
      {sources.length > 0 && <p className="mt-1 text-[11px] text-muted-foreground">Só a legenda pública é lida; vídeo e imagens não são analisados.</p>}

      {freeText && (
        <div className="mt-3 rounded-2xl border border-border bg-card p-3">
          <p className="text-[11px] text-muted-foreground">Texto enviado</p>
          <p className="mt-1 max-h-32 overflow-y-auto whitespace-pre-wrap text-sm">{freeText}</p>
          <Button variant="secondary" className="mt-2 min-h-11 w-full" disabled={!!busy} onClick={() => run("txt", () => analyzeFn({ data: { sessionId: id, text: freeText.slice(0, MAX_TEXT) } }))}>{busy === "txt" ? <LoaderCircle className="animate-spin" /> : <Sparkles />}Analisar texto com IA</Button>
        </div>
      )}

      <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => { readImage(e.target.files?.[0], setImage); e.target.value = ""; }} />
      <div className="mt-3 flex items-center gap-2">
        <Button variant="secondary" className="min-h-11" onClick={() => fileRef.current?.click()}><ImagePlus />{image ? "Trocar captura" : "Escolher captura"}</Button>
        {image && <Button className="min-h-11 flex-1" disabled={!!busy} onClick={() => run("img", async () => { const r = await analyzeFn({ data: { sessionId: id, image: { mimeType: image.mimeType, base64: image.base64 } } }); if (r.ok) { pendingImages.delete(id); setImage(null); } return r; })}>{busy === "img" ? <LoaderCircle className="animate-spin" /> : <Sparkles />}Analisar captura</Button>}
      </div>

      {notice && <p role="status" className="mt-4 rounded-xl border border-border bg-card p-3 text-sm text-muted-foreground">{notice}</p>}

      {cands.length > 0 ? (
        <div className="mt-4 rounded-2xl border border-border bg-card p-3">
          <p className="text-xs text-muted-foreground">{cands.length} {cands.length === 1 ? "obra" : "obras"} · {left} pendentes · {cands.filter((c) => c.status === "saved").length} confirmadas</p>
          <div className="mt-2 flex gap-2 overflow-hidden">{cands.slice(0, 6).map((c) => <div key={c.id} className="w-10 shrink-0"><Poster path={c.poster_path} title={c.title} /></div>)}</div>
          <Button className="mt-3 min-h-12 w-full" onClick={() => setReviewing(true)}>Revisar {cands.length} {cands.length === 1 ? "obra" : "obras"}</Button>
        </div>
      ) : s.status !== "analyzing" && <p className="mt-4 text-xs text-muted-foreground">Nenhuma obra identificada ainda. Busque a legenda, analise o texto ou envie uma captura.</p>}

      {!cands.some((c) => c.status === "saved") && (
        <Button variant="ghost" className="mt-4 min-h-11 w-full text-muted-foreground" onClick={async () => { const { error } = await supabase.rpc("import_dismiss", { _session: id }); if (error) { toast.error("Não foi possível dispensar."); return; } void qc.invalidateQueries({ queryKey: ["import-sessions"] }); void navigate({ search: {}, replace: true }); }}>Dispensar sessão (links salvos continuam)</Button>
      )}
    </main>
  );
}

function ReviewStack({ cands, lib, spaceId, sources, onChanged, onBack, onDone }: { cands: Cand[]; lib: Map<string, { workId: string; mine: boolean }>; spaceId: string; sources: Source[]; onChanged: () => Promise<unknown>; onBack: () => void; onDone: () => void }) {
  const reduce = useReducedMotion();
  const confirmFn = useServerFn(confirmCandidate);
  const correctFn = useServerFn(correctCandidate);
  const find = useServerFn(searchCatalog);
  const [index, setIndex] = useState(() => Math.max(0, cands.findIndex((c) => c.status === "pending" || c.status === "error")));
  const [fixing, setFixing] = useState(false);
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<{ mediaType: "movie" | "tv"; tmdbId: number; title: string; year: number | null; posterPath: string | null }[]>([]);
  const [dir, setDir] = useState(1);
  const [working, setWorking] = useState<string | null>(null);
  const row = cands[index];
  const go = (to: number) => { setDir(to > index ? 1 : -1); setIndex(to); setFixing(false); };
  const nextOpen = (from: number) => { const n = cands.findIndex((c, j) => j > from && (c.status === "pending" || c.status === "error")); go(n === -1 ? cands.length : n); };

  async function act(c: Cand, fn: () => Promise<unknown>, advance = false) {
    setWorking(c.id);
    try { await fn(); if (advance) nextOpen(index); } catch (e) { toast.error(e instanceof Error ? e.message : "Falhou. Tente de novo."); } finally { setWorking(null); await onChanged(); }
  }
  const rpc = async (name: "import_undo" | "import_set_reaction" | "import_set_seen", args: Record<string, unknown>) => { const { error } = await supabase.rpc(name, args as never); if (error) throw new Error("Não foi possível salvar. Tente de novo."); };

  const label = (c: Cand) => c.status === "saved" ? (c.effects?.indication === "renewed" ? "Você já tinha indicado · indicação renovada" : "Indicada por você") : c.status === "skipped" ? "Pulada" : c.status === "error" ? c.note ?? "Erro" : "Pendente";
  const summary = { saved: cands.filter((c) => c.status === "saved").length, skipped: cands.filter((c) => c.status === "skipped").length, open: cands.filter((c) => c.status === "pending" || c.status === "error").length };

  if (!row) return (
    <main className="mx-auto max-w-md px-4 pb-32 pt-[max(env(safe-area-inset-top),24px)] text-center">
      <h1 className="text-xl font-semibold">Resumo</h1>
      <p className="mt-2 text-sm text-muted-foreground">{summary.saved} indicadas · {summary.skipped} puladas · {summary.open} pendentes</p>
      <ul className="mt-5 space-y-2 text-left">{cands.map((c, i) => <li key={c.id} className="flex items-center gap-3 rounded-xl border border-border p-2"><div className="w-9 shrink-0"><Poster path={c.poster_path} title={c.title} /></div><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{c.title}</p><p className="text-[11px] text-muted-foreground">{label(c)}</p></div><Button variant="ghost" className="min-h-11 text-xs" onClick={() => go(i)}>Abrir</Button></li>)}</ul>
      <Button className="mt-6 min-h-12 w-full" disabled={summary.open > 0} onClick={onDone}>Concluir sessão</Button>
      <Button variant="ghost" className="mt-2 min-h-12 w-full" onClick={onBack}>Voltar à sessão</Button>
    </main>
  );

  const libInfo = lib.get(`${row.media_type}:${row.tmdb_id}`);
  const source = sources.find((p) => p.id === row.source_post_id);
  const backdrop = tmdbImage(row.backdrop_path ?? row.poster_path, "w780");
  const busy = working === row.id;
  return (
    <main className="relative mx-auto min-h-[100dvh] max-w-md overflow-hidden px-4 pb-32 pt-[max(env(safe-area-inset-top),16px)]">
      {backdrop && <img src={backdrop} alt="" aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-80 w-full object-cover opacity-40" />}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-80 bg-gradient-to-b from-background/30 to-background" />
      <div className="relative">
        <div className="flex items-center justify-between">
          <Button variant="ghost" size="icon" aria-label="Voltar à sessão" className="h-11 w-11" onClick={onBack}><ChevronLeft /></Button>
          <span className="text-xs text-muted-foreground">{index + 1} de {cands.length}</span>
          <Button variant="ghost" className="min-h-11 text-xs" onClick={() => go(cands.length)}>Resumo</Button>
        </div>
        <AnimatePresence mode="popLayout" initial={false} custom={dir}>
          <motion.section key={row.id + row.tmdb_id} custom={dir} initial={reduce ? { opacity: 0 } : { opacity: 0, x: 60 * dir, rotate: 2 * dir }} animate={{ opacity: 1, x: 0, rotate: 0 }} exit={reduce ? { opacity: 0 } : { opacity: 0, x: -60 * dir, rotate: -2 * dir }} transition={{ duration: reduce ? 0.01 : 0.28, ease: [0.22, 1, 0.36, 1] }} className="mt-4 text-center">
            <div className="relative mx-auto w-44">
              <div className="match-stack-back absolute inset-0 translate-x-2 translate-y-2 rotate-3 rounded-xl bg-card" aria-hidden />
              <div className="art-edge relative overflow-hidden rounded-xl"><Poster eager path={row.poster_path} title={row.title} /></div>
            </div>
            <h2 className="mt-4 text-xl font-semibold">{row.title}</h2>
            <p className="mt-1 text-xs text-muted-foreground">{[row.year, row.media_type === "tv" ? "Série" : "Filme", row.original_title && row.original_title !== row.title ? row.original_title : null].filter(Boolean).join(" · ")}</p>
            <p className="mt-1 truncate text-[11px] text-muted-foreground">Fonte: {source ? source.source_url : "texto/captura desta sessão"}</p>
            {row.status !== "saved" && libInfo && <p className="mt-2 text-xs text-primary">{libInfo.mine ? "Já está na biblioteca e você já indicou · confirmar renova sua indicação" : "Já está na biblioteca · você ainda não indicou"}</p>}
            <p className="mt-2 text-xs text-muted-foreground">{label(row)}</p>
          </motion.section>
        </AnimatePresence>

        <button type="button" aria-pressed={row.seen} disabled={busy} onClick={() => act(row, () => rpc("import_set_seen", { _candidate: row.id, _seen: !row.seen }))} className={`pressable mx-auto mt-5 flex min-h-11 items-center gap-2 rounded-full border px-4 text-xs ${row.seen ? "border-primary bg-primary/15 text-primary" : "border-border text-muted-foreground"}`}><Check className="h-4 w-4" />Já assisti antes</button>

        <div className="mt-4 grid grid-cols-4 gap-2">
          {row.status === "saved"
            ? <Button variant="secondary" aria-label="Desfazer" className="min-h-14" disabled={busy} onClick={() => act(row, () => rpc("import_undo", { _candidate: row.id }))}><Undo2 /></Button>
            : <Button variant="secondary" aria-label={row.status === "skipped" ? "Voltar a pendente" : "Pular"} className="min-h-14" disabled={busy} onClick={() => act(row, async () => { const { error } = await supabase.from("import_candidates").update({ status: row.status === "skipped" ? "pending" : "skipped" }).eq("id", row.id); if (error) throw error; }, row.status !== "skipped")}>{row.status === "skipped" ? <Undo2 /> : <X />}</Button>}
          {([["fire", "🔥"], ["like", "👍"], ["neutral", "😐"]] as const).map(([r, e]) => (
            <Button key={r} variant="secondary" aria-label={row.status === "saved" ? `Mudar reação para ${e}` : `Indicar com ${e}`} aria-pressed={row.status === "saved" && row.reaction === r} disabled={busy} className={`min-h-14 text-2xl emoji ${row.status === "saved" && row.reaction === r ? "ring-2 ring-primary" : ""}`}
              onClick={() => row.status === "saved" ? act(row, () => rpc("import_set_reaction", { _candidate: row.id, _reaction: r })) : act(row, () => confirmFn({ data: { candidateId: row.id, reaction: r } }), true)}>{busy ? <LoaderCircle className="animate-spin" /> : e}</Button>
          ))}
        </div>

        <div className="mt-4 flex items-center justify-between">
          <Button variant="ghost" className="min-h-11" disabled={index === 0} onClick={() => go(index - 1)}><ChevronLeft />Anterior</Button>
          <Button variant="ghost" className="min-h-11 text-xs" onClick={() => { if (row.status === "saved") { toast("Desfaça a confirmação antes de corrigir."); return; } setFixing((v) => !v); setQuery(row.title); setOptions([]); }}><Search className="h-4 w-4" />Corrigir</Button>
          <Button variant="ghost" className="min-h-11" onClick={() => go(index + 1)}>Próxima<ChevronRight /></Button>
        </div>

        <AnimatePresence initial={false}>{fixing && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="mt-2 flex gap-2"><input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={async (e) => { if (e.key === "Enter" && query.trim().length >= 2) setOptions(((await find({ data: { query: query.trim(), spaceId, page: 1 } }).catch(() => [])) as typeof options).slice(0, 6)); }} aria-label="Buscar correspondência correta" className="min-h-11 flex-1 rounded-xl border border-border bg-card px-3 text-sm outline-none focus:border-primary" /><Button className="min-h-11" onClick={async () => { if (query.trim().length >= 2) setOptions(((await find({ data: { query: query.trim(), spaceId, page: 1 } }).catch(() => [])) as typeof options).slice(0, 6)); }}><Search /></Button></div>
            <ul className="mt-2 space-y-1">{options.map((o) => <li key={`${o.mediaType}:${o.tmdbId}`}><button type="button" className="pressable flex min-h-14 w-full items-center gap-3 rounded-xl p-1 text-left" onClick={() => act(row, async () => { await correctFn({ data: { candidateId: row.id, mediaType: o.mediaType, tmdbId: o.tmdbId } }); setFixing(false); })}><div className="w-9 shrink-0"><Poster path={o.posterPath} title={o.title} /></div><span className="min-w-0 flex-1 truncate text-sm">{o.title}</span><span className="text-[11px] text-muted-foreground">{o.year ?? "—"} · {o.mediaType === "tv" ? "Série" : "Filme"}</span></button></li>)}</ul>
          </motion.div>
        )}</AnimatePresence>
      </div>
    </main>
  );
}
