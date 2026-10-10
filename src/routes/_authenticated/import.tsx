import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Check, ChevronLeft, ChevronRight, ImagePlus, LoaderCircle, Search, Sparkles, Undo2, X } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/app/AppShell";
import { BackButton } from "@/components/app/ui";
import { Poster } from "@/components/app/MediaCard";
import { Button } from "@/components/ui/button";
import { analyzeImport } from "@/lib/ai.functions";
import { addWork, markSeenBefore, searchCatalog } from "@/lib/catalog.functions";
import { fetchSocialCaptions, resolveImportText } from "@/lib/import.functions";
import { tmdbImage } from "@/lib/format";
import { useSpace } from "@/lib/space";

const MAX_TEXT = 4000;
const MAX_IMAGE = 4 * 1024 * 1024;
const DRAFT_KEY = "import-draft";
const DRAFT_TTL = 30 * 60_000;

type Candidate = { mediaType: "movie" | "tv"; tmdbId: number; title: string; originalTitle: string | null; posterPath: string | null; backdropPath: string | null; year: number | null; existingWorkId: string | null };
type Status = "pending" | "skipped" | "saving" | "saved" | "partial" | "error";
// partial = indication saved but "Já assisti antes" failed (no transaction exists; retry only the mark).
type Row = { c: Candidate; status: Status; note?: string | undefined; seen?: boolean };

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
  // Web Share Target (GET) sends title/text/url; the auth gate preserves them via ?next=.
  validateSearch: (s: Record<string, unknown>): { title?: string; text?: string; url?: string } => ({
    ...(typeof s["title"] === "string" ? { title: s["title"].slice(0, 300) } : {}),
    ...(typeof s["text"] === "string" ? { text: s["text"].slice(0, MAX_TEXT) } : {}),
    ...(typeof s["url"] === "string" ? { url: s["url"].slice(0, 1000) } : {}),
  }),
  component: () => (
    <AppShell>
      <ImportPage />
    </AppShell>
  ),
});

/** Client-side canonical form for the saved-links box (no fetch). Keeps ?img_index=N for Instagram carousels. */
function canonicalSocial(raw: string): { platform: "instagram" | "tiktok"; url: string } | null {
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  const host = u.hostname.toLowerCase();
  let m: RegExpMatchArray | null;
  if ((host === "instagram.com" || host === "www.instagram.com") && (m = u.pathname.match(/^\/(?:[\w.]{1,30}\/)?(?:reel|reels|p)\/([A-Za-z0-9_-]{5,40})\/?$/))) {
    const n = Number(u.searchParams.get("img_index"));
    return { platform: "instagram", url: `https://www.instagram.com/p/${m[1]}/${Number.isInteger(n) && n >= 1 && n <= 20 ? `?img_index=${n}` : ""}` };
  }
  if ((host === "tiktok.com" || host === "www.tiktok.com" || host === "m.tiktok.com") && (m = u.pathname.match(/^\/@([\w.-]{1,40})\/(video|photo)\/(\d{8,25})\/?$/)))
    return { platform: "tiktok", url: `https://www.tiktok.com/@${m[1]}/${m[2]}/${m[3]}` };
  if ((host === "vt.tiktok.com" || host === "vm.tiktok.com") && (m = u.pathname.match(/^\/([A-Za-z0-9]{5,15})\/?$/)))
    return { platform: "tiktok", url: `https://${host}/${m[1]}/` };
  return null;
}

const key = (c: Candidate) => `${c.mediaType}:${c.tmdbId}`;

function ImportPage() {
  const { data: space } = useSpace();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const qc = useQueryClient();
  const resolve = useServerFn(resolveImportText);
  const analyze = useServerFn(analyzeImport);
  const fetchCaptions = useServerFn(fetchSocialCaptions);
  type Caption = Awaited<ReturnType<typeof fetchSocialCaptions>>["results"][number];
  const [captions, setCaptions] = useState<Caption[]>([]);
  const [captionBusy, setCaptionBusy] = useState<string | null>(null);
  const shared = [search.title, search.text, search.url].filter(Boolean).join("\n").slice(0, MAX_TEXT);
  const [text, setText] = useState(shared);
  const hasSocial = /instagram\.com\/(?:[\w.]+\/)?(?:reels?|p)\/|tiktok\.com\/@[^/\s]+\/(?:video|photo)\/|v[tm]\.tiktok\.com\//i.test(text);
  const [image, setImage] = useState<{ name: string; mimeType: "image/png" | "image/jpeg" | "image/webp"; base64: string } | null>(null);
  const [busy, setBusy] = useState<null | "resolve" | "ai">(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [hasText, setHasText] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [reviewing, setReviewing] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const autoRan = useRef(false);

  // Draft survives login/reload in this tab for a limited time; never stores images.
  useEffect(() => {
    if (shared) return;
    try {
      const d = JSON.parse(sessionStorage.getItem(DRAFT_KEY) ?? "null") as { text: string; at: number } | null;
      if (d && Date.now() - d.at < DRAFT_TTL) setText(d.text.slice(0, MAX_TEXT));
    } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (text) sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ text, at: Date.now() }));
    else sessionStorage.removeItem(DRAFT_KEY);
  }, [text]);

  const merge = (items: Candidate[]) => {
    // Functional update: rapid resolutions accumulate instead of overwriting each other.
    setRows((prev) => {
      const map = new Map<string, Row>(prev.map((r) => [key(r.c), r]));
      for (const c of items) if (!map.has(key(c))) map.set(key(c), { c, status: "pending" });
      return [...map.values()];
    });
  };

  async function runResolve(value = text) {
    if (!space?.spaceId || !value.trim()) return;
    setBusy("resolve");
    setNotice(null);
    try {
      const r = await resolve({ data: { spaceId: space.spaceId, text: value.slice(0, MAX_TEXT) } });
      setHasText(r.hasText);
      if (r.items.length) merge(r.items);
      if (r.social.length && !r.items.length)
        setNotice(`Link de rede social (${r.social.join(", ")}) não identifica a obra sozinho. Use “Buscar legenda do post”, cole a legenda ou envie uma captura.`);
      else if (!r.items.length) setNotice(r.hasText ? "Nenhum link do TMDB/IMDb reconhecido. Use “Analisar com IA” para identificar títulos no texto." : "Nada reconhecido. Cole um texto ou envie uma captura.");
    } catch {
      setNotice("Não foi possível analisar agora. Tente de novo.");
    } finally {
      setBusy(null);
    }
  }

  useEffect(() => {
    if (shared && space?.spaceId && !autoRan.current) { autoRan.current = true; void runResolve(shared); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [space?.spaceId]);

  async function runAi() {
    if (!space?.spaceId || (!text.trim() && !image)) return;
    setBusy("ai");
    setNotice(null);
    try {
      const r = await analyze({ data: { spaceId: space.spaceId, ...(text.trim() ? { text: text.slice(0, MAX_TEXT) } : {}), ...(image ? { image: { mimeType: image.mimeType, base64: image.base64 } } : {}) } });
      if (!r.ok) setNotice(r.reason);
      else if (!r.items.length) setNotice("A IA não encontrou filmes ou séries reconhecíveis. Nada foi inventado.");
      else merge(r.items);
    } catch {
      setNotice("A IA não respondeu. Tente de novo mais tarde.");
    } finally {
      setBusy(null);
    }
  }

  const saved = useQuery({
    queryKey: ["source-posts", space?.spaceId],
    enabled: !!space?.spaceId,
    queryFn: async () => (await supabase.from("source_posts").select("id, platform, source_url, created_at").eq("space_id", space!.spaceId!).is("work_id", null).order("created_at", { ascending: false }).limit(20)).data ?? [],
  });
  const [saving, setSaving] = useState(false);

  // Explicit action: store recognised post links (max 12) as pending, work_id null. Never creates works/indications.
  async function saveLinks() {
    if (!space?.spaceId) return;
    const found = [...new Map([...text.matchAll(/https?:\/\/[^\s<>"']+/gi)].map((m) => canonicalSocial(m[0])).filter((x): x is NonNullable<typeof x> => !!x).map((x) => [x.url, x])).values()].slice(0, 12);
    if (!found.length) { setNotice("Nenhum link de post do Instagram ou TikTok reconhecido."); return; }
    setSaving(true);
    try {
      const { data: existing, error: e1 } = await supabase.from("source_posts").select("source_url").eq("space_id", space.spaceId).in("source_url", found.map((f) => f.url));
      if (e1) throw e1;
      const have = new Set((existing ?? []).map((r) => r.source_url));
      const fresh = found.filter((f) => !have.has(f.url));
      const { data: { user } } = await supabase.auth.getUser();
      if (fresh.length && user) {
        const { error } = await supabase.from("source_posts").upsert(fresh.map((f) => ({ space_id: space.spaceId!, platform: f.platform, source_url: f.url, created_by: user.id, work_id: null })), { onConflict: "space_id,source_url", ignoreDuplicates: true });
        if (error) throw error;
      }
      toast.success(`${fresh.length} ${fresh.length === 1 ? "link novo salvo" : "links novos salvos"} · ${found.length - fresh.length} já existiam`);
      void saved.refetch();
    } catch {
      toast.error("Não foi possível salvar os links.");
    } finally {
      setSaving(false);
    }
  }

  async function runCaptions() {
    setCaptionBusy("fetch");
    setNotice(null);
    try {
      const r = await fetchCaptions({ data: { text: text.slice(0, MAX_TEXT) } });
      if (!r.recognised) setNotice("Nenhum link de post do Instagram (reel/p) ou TikTok (vídeo/foto) reconhecido.");
      setCaptions(r.results);
    } catch {
      setNotice("Não foi possível buscar a legenda agora.");
    } finally {
      setCaptionBusy(null);
    }
  }

  // One AI batch per caption, only on tap; existing analyzeImport cache applies.
  async function analyzeCaption(c: Caption) {
    if (!space?.spaceId || !c.caption) return;
    setCaptionBusy(c.canonical);
    setNotice(null);
    try {
      const r = await analyze({ data: { spaceId: space.spaceId, text: c.caption.slice(0, MAX_TEXT) } });
      if (!r.ok) setNotice(r.reason);
      else if (!r.items.length) setNotice("A legenda não cita filmes ou séries reconhecíveis. Em listas, Reels e carrosséis, envie capturas de tela das imagens.");
      else merge(r.items);
    } catch {
      setNotice("A IA não respondeu. Tente de novo mais tarde.");
    } finally {
      setCaptionBusy(null);
    }
  }

  function pickImage(file: File | undefined) {
    if (!file) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) { toast.error("Use PNG, JPEG ou WebP."); return; }
    if (file.size > MAX_IMAGE) { toast.error("Imagem acima de 4 MB."); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = String(reader.result).split(",")[1] ?? "";
      setImage({ name: file.name, mimeType: file.type as "image/png", base64 });
    };
    reader.readAsDataURL(file);
  }

  const finish = () => {
    sessionStorage.removeItem(DRAFT_KEY);
    void qc.invalidateQueries({ queryKey: ["library", space?.spaceId] });
  };

  if (reviewing && rows.length) return <ReviewStack rows={rows} setRows={setRows} spaceId={space?.spaceId ?? ""} onDone={() => { finish(); setRows([]); setReviewing(false); setText(""); setImage(null); void navigate({ search: {}, replace: true }); }} onBack={() => setReviewing(false)} />;

  return (
    <main className="mx-auto max-w-md px-4 pb-32 pt-[max(env(safe-area-inset-top),16px)]">
      <div className="flex items-center gap-2"><BackButton /><h1 className="text-xl font-semibold">Importar</h1></div>
      <p className="mt-2 text-sm text-muted-foreground">Cole um link ou texto, ou envie uma captura. Você revisa cada obra antes de indicar.</p>
      <textarea value={text} onChange={(e) => setText(e.target.value.slice(0, MAX_TEXT))} rows={6} placeholder="Link do TMDB/IMDb, legenda do post, lista de títulos…" aria-label="Link ou texto para importar" className="mt-4 w-full rounded-2xl border border-border bg-card p-3 text-sm outline-none focus:border-primary" />
      <p className="mt-1 text-right text-[11px] text-muted-foreground">{text.length}/{MAX_TEXT}</p>
      <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => { pickImage(e.target.files?.[0]); e.target.value = ""; }} />
      <div className="mt-2 flex items-center gap-2">
        <Button variant="secondary" className="min-h-11" onClick={() => fileRef.current?.click()}><ImagePlus />{image ? "Trocar captura" : "Escolher captura"}</Button>
        {image && <span className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground"><span className="truncate">{image.name}</span><Button variant="ghost" size="icon" aria-label="Remover captura" className="h-11 w-11" onClick={() => setImage(null)}><X className="h-4 w-4" /></Button></span>}
      </div>
      <div className="mt-5 space-y-2">
        <Button className="min-h-12 w-full" disabled={!text.trim() || !!busy} onClick={() => runResolve()}>{busy === "resolve" ? <LoaderCircle className="animate-spin" /> : <Search />}Identificar links</Button>
        <Button variant="secondary" className="min-h-12 w-full" disabled={(!text.trim() && !image) || !!busy} onClick={runAi}>{busy === "ai" ? <LoaderCircle className="animate-spin" /> : <Sparkles />}Analisar com IA{image ? " (texto + captura)" : ""}</Button>
      </div>
      {hasSocial && (
        <div className="mt-2">
          <Button variant="outline" className="min-h-12 w-full" disabled={!!busy || !!captionBusy} onClick={runCaptions}>{captionBusy === "fetch" ? <LoaderCircle className="animate-spin" /> : <Search />}Buscar legenda do post</Button>
          <p className="mt-1 text-[11px] text-muted-foreground">Lê só a legenda pública do post. Vídeo e imagens não são analisados.</p>
        </div>
      )}
      {hasSocial && <Button variant="ghost" className="mt-1 min-h-11 w-full" disabled={saving} onClick={saveLinks}>{saving && <LoaderCircle className="animate-spin" />}Salvar links</Button>}
      {captions.map((c) => (
        <div key={c.canonical} className="mt-3 rounded-2xl border border-border bg-card p-3">
          <p className="text-[11px] text-muted-foreground">Origem: {c.platform === "instagram" ? "Instagram" : "TikTok"}{c.author ? ` · @${c.author}` : ""}</p>
          <p className="truncate text-[11px] text-muted-foreground">{c.canonical}</p>
          {c.caption ? <p className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap rounded-xl bg-background/60 p-2 text-sm">{c.caption}</p> : null}
          {c.imgIndex ? <p className="mt-2 text-xs text-primary">Link aponta para a imagem {c.imgIndex} do carrossel. A imagem não é lida: envie a captura dessa imagem.</p> : null}
          {c.message && <p role="status" className="mt-2 text-xs text-muted-foreground">{c.message}</p>}
          {c.caption && <p className="mt-2 text-[11px] text-muted-foreground">A legenda pode não citar as obras. Se for uma lista, Reel ou carrossel, envie capturas.</p>}
          {c.caption && <Button variant="secondary" className="mt-2 min-h-11 w-full" disabled={!!busy || !!captionBusy} onClick={() => analyzeCaption(c)}>{captionBusy === c.canonical ? <LoaderCircle className="animate-spin" /> : <Sparkles />}Analisar legenda com IA</Button>}
        </div>
      ))}
      {rows.length > 0 && (
        <div className="mt-4 rounded-2xl border border-border bg-card p-3">
          <p className="text-xs text-muted-foreground">{rows.length} {rows.length === 1 ? "obra encontrada" : "obras encontradas"} · continue identificando links ou analisando texto/captura para acumular.</p>
          <div className="mt-2 flex gap-2 overflow-hidden">{rows.slice(0, 6).map((r) => <div key={key(r.c)} className="w-10 shrink-0"><Poster path={r.c.posterPath} title={r.c.title} /></div>)}</div>
          <Button className="mt-3 min-h-12 w-full" onClick={() => setReviewing(true)}>Revisar {rows.length} {rows.length === 1 ? "obra" : "obras"}</Button>
        </div>
      )}
      {(saved.data?.length ?? 0) > 0 && (
        <section className="mt-5">
          <h2 className="text-sm font-semibold">Links salvos pendentes</h2>
          <ul className="mt-2 space-y-1">{saved.data!.map((p) => (
            <li key={p.id} className="flex items-center gap-2 rounded-xl border border-border px-3 py-1">
              <div className="min-w-0 flex-1">
                <a href={p.source_url} target="_blank" rel="noopener noreferrer" className="block truncate text-xs text-primary underline-offset-2 hover:underline">{p.source_url}</a>
                <p className="text-[11px] text-muted-foreground">{p.platform === "instagram" ? "Instagram" : p.platform === "tiktok" ? "TikTok" : p.platform} · {new Date(p.created_at).toLocaleDateString("pt-BR")}</p>
              </div>
              <Button variant="ghost" className="min-h-11 shrink-0 text-xs" onClick={() => { setText(p.source_url); setCaptions([]); setNotice(null); window.scrollTo({ top: 0, behavior: "smooth" }); }}>Analisar</Button>
            </li>
          ))}</ul>
        </section>
      )}
      {notice && <p role="status" className="mt-4 rounded-xl border border-border bg-card p-3 text-sm text-muted-foreground">{notice}</p>}
      {hasText && !notice && <p className="mt-3 text-xs text-muted-foreground">Há texto livre; a IA pode encontrar mais títulos.</p>}
    </main>
  );
}

function ReviewStack({ rows, setRows, spaceId, onDone, onBack }: { rows: Row[]; setRows: React.Dispatch<React.SetStateAction<Row[]>>; spaceId: string; onDone: () => void; onBack: () => void }) {
  const reduce = useReducedMotion();
  const add = useServerFn(addWork);
  const seenBefore = useServerFn(markSeenBefore);
  const find = useServerFn(searchCatalog);
  const [index, setIndex] = useState(() => Math.max(0, rows.findIndex((r) => r.status === "pending")));
  const [fixing, setFixing] = useState(false);
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<Candidate[]>([]);
  const [dir, setDir] = useState(1);
  const row = rows[index];
  const update = (i: number, patch: Partial<Row>) => setRows((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const go = (to: number) => { setDir(to > index ? 1 : -1); setIndex(to); setFixing(false); };
  const nextPending = (from: number) => { const n = rows.findIndex((r, j) => j > from && r.status === "pending"); go(n === -1 ? rows.length : n); };

  async function confirm(reaction: "fire" | "like" | "neutral") {
    const i = index;
    const { c, seen } = rows[i]!;
    update(i, { status: "saving", note: undefined });
    nextPending(i);
    // Indication first: a failed indication never leaves "Já assisti antes" recorded alone.
    try {
      await add({ data: { spaceId, mediaType: c.mediaType, tmdbId: c.tmdbId, reaction } });
    } catch (e) {
      update(i, { status: "error", note: e instanceof Error ? e.message : "Falha ao salvar" });
      return;
    }
    const renewed = c.existingWorkId ? "Já estava na biblioteca · indicação renovada" : undefined;
    if (!seen) { update(i, { status: "saved", note: renewed }); return; }
    await markSeen(i, renewed);
  }

  async function markSeen(i: number, prefix?: string) {
    const c = rows[i]!.c;
    update(i, { status: "saving" });
    try {
      await seenBefore({ data: { spaceId, mediaType: c.mediaType, tmdbId: c.tmdbId, score: null } });
      update(i, { status: "saved", note: [prefix, "Já assisti antes marcado"].filter(Boolean).join(" · ") });
    } catch {
      update(i, { status: "partial", note: "Indicação salva · falhou marcar “Já assisti antes”" });
    }
  }

  async function lookup() {
    if (query.trim().length < 2) return;
    const r = await find({ data: { query: query.trim(), spaceId, page: 1 } }).catch(() => []);
    setOptions(r.slice(0, 6) as Candidate[]);
  }

  const summary = { saved: rows.filter((r) => r.status === "saved").length, skipped: rows.filter((r) => r.status === "skipped").length, errors: rows.filter((r) => r.status === "error").length, partial: rows.filter((r) => r.status === "partial").length, saving: rows.some((r) => r.status === "saving") };

  if (!row) return (
    <main className="mx-auto max-w-md px-4 pb-32 pt-[max(env(safe-area-inset-top),24px)] text-center">
      <h1 className="text-xl font-semibold">Revisão concluída</h1>
      <p className="mt-2 text-sm text-muted-foreground">{summary.saved} indicadas · {summary.skipped} puladas · {summary.errors} com erro{summary.partial ? ` · ${summary.partial} parcial` : ""}{summary.saving ? " · salvando…" : ""}</p>
      <ul className="mt-5 space-y-2 text-left">{rows.map((r, i) => <li key={key(r.c)} className="flex items-center gap-3 rounded-xl border border-border p-2"><div className="w-9 shrink-0"><Poster path={r.c.posterPath} title={r.c.title} /></div><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{r.c.title}</p><p className="text-[11px] text-muted-foreground">{r.status === "saved" ? "Indicada" : r.status === "skipped" ? "Pulada" : r.status === "error" || r.status === "partial" ? r.note : r.status === "saving" ? "Salvando…" : "Pendente"}{r.status === "saved" && r.note ? ` · ${r.note}` : ""}</p></div>{(r.status === "skipped" || r.status === "error" || r.status === "pending") && <Button variant="ghost" className="min-h-11 text-xs" onClick={() => { update(i, { status: "pending" }); go(i); }}>Rever</Button>}{r.status === "partial" && <Button variant="ghost" className="min-h-11 text-xs" onClick={() => markSeen(i)}>Tentar marcar visto</Button>}</li>)}</ul>
      <Button className="mt-6 min-h-12 w-full" disabled={summary.saving} onClick={onDone}>Concluir</Button>
      <Button asChild variant="ghost" className="mt-2 min-h-12 w-full"><Link to="/library">Ver biblioteca</Link></Button>
    </main>
  );

  const backdrop = tmdbImage(row.c.backdropPath ?? row.c.posterPath, "w780");
  return (
    <main className="relative mx-auto min-h-[100dvh] max-w-md overflow-hidden px-4 pb-32 pt-[max(env(safe-area-inset-top),16px)]">
      {backdrop && <img src={backdrop} alt="" aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-80 w-full object-cover opacity-40" />}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-80 bg-gradient-to-b from-background/30 to-background" />
      <div className="relative">
        <div className="flex items-center justify-between">
          <Button variant="ghost" size="icon" aria-label="Voltar à entrada" className="h-11 w-11" onClick={onBack}><ChevronLeft /></Button>
          <span className="text-xs text-muted-foreground">{index + 1} de {rows.length}</span>
          <Button variant="ghost" className="min-h-11 text-xs" onClick={() => go(rows.length)}>Resumo</Button>
        </div>
        <AnimatePresence mode="popLayout" initial={false} custom={dir}>
          <motion.section key={key(row.c)} custom={dir} initial={reduce ? { opacity: 0 } : { opacity: 0, x: 60 * dir, rotate: 2 * dir }} animate={{ opacity: 1, x: 0, rotate: 0 }} exit={reduce ? { opacity: 0 } : { opacity: 0, x: -60 * dir, rotate: -2 * dir }} transition={{ duration: reduce ? 0.01 : 0.28, ease: [0.22, 1, 0.36, 1] }} className="mt-4 text-center">
            <div className="relative mx-auto w-44">
              <div className="match-stack-back absolute inset-0 translate-x-2 translate-y-2 rotate-3 rounded-xl bg-card" aria-hidden />
              <div className="art-edge relative overflow-hidden rounded-xl"><Poster eager path={row.c.posterPath} title={row.c.title} /></div>
            </div>
            <h2 className="mt-4 text-xl font-semibold">{row.c.title}</h2>
            <p className="mt-1 text-xs text-muted-foreground">{[row.c.year, row.c.mediaType === "tv" ? "Série" : "Filme", row.c.originalTitle && row.c.originalTitle !== row.c.title ? row.c.originalTitle : null].filter(Boolean).join(" · ")}</p>
            {row.c.existingWorkId && <p className="mt-2 text-xs text-primary">Já está na biblioteca · confirmar só renova sua indicação</p>}
            {row.status !== "pending" && <p className="mt-2 text-xs text-muted-foreground">{row.status === "saved" ? "Indicada" : row.status === "skipped" ? "Pulada" : row.status === "saving" ? "Salvando…" : row.status === "partial" ? row.note : `Erro: ${row.note}`}</p>}
          </motion.section>
        </AnimatePresence>

        {row.status === "partial" && <Button variant="secondary" className="mx-auto mt-5 flex min-h-11" onClick={() => markSeen(index)}>Tentar marcar “Já assisti antes”</Button>}
        {row.status === "saved" || row.status === "saving" || row.status === "partial" ? null : (
          <>
            <button type="button" aria-pressed={!!row.seen} onClick={() => update(index, { seen: !row.seen })} className={`pressable mx-auto mt-5 flex min-h-11 items-center gap-2 rounded-full border px-4 text-xs ${row.seen ? "border-primary bg-primary/15 text-primary" : "border-border text-muted-foreground"}`}><Check className="h-4 w-4" />Já assisti antes</button>
            <div className="mt-4 grid grid-cols-4 gap-2">
              <Button variant="secondary" aria-label="Pular" className="min-h-14" onClick={() => { update(index, { status: "skipped" }); nextPending(index); }}><X /></Button>
              {([["fire", "🔥"], ["like", "👍"], ["neutral", "😐"]] as const).map(([r, e]) => <Button key={r} variant="secondary" aria-label={`Indicar com ${e}`} className="min-h-14 text-2xl emoji" onClick={() => confirm(r)}>{e}</Button>)}
            </div>
          </>
        )}

        <div className="mt-4 flex items-center justify-between">
          <Button variant="ghost" className="min-h-11" disabled={index === 0} onClick={() => go(index - 1)}><ChevronLeft />Anterior</Button>
          <Button variant="ghost" className="min-h-11 text-xs" onClick={() => { setFixing((v) => !v); setQuery(row.c.title); setOptions([]); }}><Undo2 className="h-4 w-4" />Corrigir</Button>
          <Button variant="ghost" className="min-h-11" onClick={() => go(index + 1)}>Próxima<ChevronRight /></Button>
        </div>

        <AnimatePresence initial={false}>{fixing && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="mt-2 flex gap-2"><input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && lookup()} aria-label="Buscar correspondência correta" className="min-h-11 flex-1 rounded-xl border border-border bg-card px-3 text-sm outline-none focus:border-primary" /><Button className="min-h-11" onClick={lookup}><Search /></Button></div>
            <ul className="mt-2 space-y-1">{options.map((o) => <li key={key(o)}><button type="button" className="pressable flex min-h-14 w-full items-center gap-3 rounded-xl p-1 text-left" onClick={() => { if (rows.some((r, j) => j !== index && key(r.c) === key(o))) { toast("Essa obra já está na pilha."); return; } update(index, { c: o, status: "pending", note: undefined }); setFixing(false); }}><div className="w-9 shrink-0"><Poster path={o.posterPath} title={o.title} /></div><span className="min-w-0 flex-1 truncate text-sm">{o.title}</span><span className="text-[11px] text-muted-foreground">{o.year ?? "—"} · {o.mediaType === "tv" ? "Série" : "Filme"}</span></button></li>)}</ul>
          </motion.div>
        )}</AnimatePresence>
      </div>
    </main>
  );
}
