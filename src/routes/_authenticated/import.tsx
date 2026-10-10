import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
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
import { resolveImportText } from "@/lib/import.functions";
import { tmdbImage } from "@/lib/format";
import { useSpace } from "@/lib/space";

const MAX_TEXT = 4000;
const MAX_IMAGE = 4 * 1024 * 1024;
const DRAFT_KEY = "import-draft";
const DRAFT_TTL = 30 * 60_000;

type Candidate = { mediaType: "movie" | "tv"; tmdbId: number; title: string; originalTitle: string | null; posterPath: string | null; backdropPath: string | null; year: number | null; existingWorkId: string | null };
type Status = "pending" | "skipped" | "saving" | "saved" | "error";
type Row = { c: Candidate; status: Status; note?: string | undefined };

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

const key = (c: Candidate) => `${c.mediaType}:${c.tmdbId}`;

function ImportPage() {
  const { data: space } = useSpace();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const qc = useQueryClient();
  const resolve = useServerFn(resolveImportText);
  const analyze = useServerFn(analyzeImport);
  const shared = [search.title, search.text, search.url].filter(Boolean).join("\n").slice(0, MAX_TEXT);
  const [text, setText] = useState(shared);
  const [image, setImage] = useState<{ name: string; mimeType: "image/png" | "image/jpeg" | "image/webp"; base64: string } | null>(null);
  const [busy, setBusy] = useState<null | "resolve" | "ai">(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [hasText, setHasText] = useState(false);
  const [rows, setRows] = useState<Row[] | null>(null);
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
    const map = new Map<string, Row>();
    for (const r of rows ?? []) map.set(key(r.c), r);
    for (const c of items) if (!map.has(key(c))) map.set(key(c), { c, status: "pending" });
    setRows([...map.values()]);
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
        setNotice(`Não foi possível identificar a obra pelo link (${r.social.join(", ")}). Envie uma captura de tela ou cole a legenda/texto do post.`);
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

  if (rows && rows.length) return <ReviewStack rows={rows} setRows={setRows} spaceId={space?.spaceId ?? ""} onDone={() => { finish(); setRows(null); setText(""); setImage(null); void navigate({ search: {}, replace: true }); }} onBack={() => setRows(null)} />;

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
      {notice && <p role="status" className="mt-4 rounded-xl border border-border bg-card p-3 text-sm text-muted-foreground">{notice}</p>}
      {hasText && !notice && <p className="mt-3 text-xs text-muted-foreground">Há texto livre; a IA pode encontrar mais títulos.</p>}
    </main>
  );
}

function ReviewStack({ rows, setRows, spaceId, onDone, onBack }: { rows: Row[]; setRows: (r: Row[]) => void; spaceId: string; onDone: () => void; onBack: () => void }) {
  const reduce = useReducedMotion();
  const add = useServerFn(addWork);
  const seenBefore = useServerFn(markSeenBefore);
  const find = useServerFn(searchCatalog);
  const [index, setIndex] = useState(() => Math.max(0, rows.findIndex((r) => r.status === "pending")));
  const [seen, setSeen] = useState(false);
  const [fixing, setFixing] = useState(false);
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<Candidate[]>([]);
  const [dir, setDir] = useState(1);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const row = rows[index];
  const update = (i: number, patch: Partial<Row>) => setRows(rowsRef.current.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const go = (to: number) => { setDir(to > index ? 1 : -1); setIndex(to); setSeen(false); setFixing(false); };
  const nextPending = (from: number) => { const n = rows.findIndex((r, j) => j > from && r.status === "pending"); go(n === -1 ? rows.length : n); };

  async function confirm(reaction: "fire" | "like" | "neutral") {
    const i = index;
    const c = rows[i]!.c;
    update(i, { status: "saving", note: undefined });
    nextPending(i);
    try {
      if (seen) await seenBefore({ data: { spaceId, mediaType: c.mediaType, tmdbId: c.tmdbId, score: null } });
      await add({ data: { spaceId, mediaType: c.mediaType, tmdbId: c.tmdbId, reaction } });
      update(i, { status: "saved", note: c.existingWorkId ? "Já estava na biblioteca · indicação renovada" : undefined });
    } catch (e) {
      update(i, { status: "error", note: e instanceof Error ? e.message : "Falha ao salvar" });
    }
  }

  async function lookup() {
    if (query.trim().length < 2) return;
    const r = await find({ data: { query: query.trim(), spaceId, page: 1 } }).catch(() => []);
    setOptions(r.slice(0, 6) as Candidate[]);
  }

  const summary = { saved: rows.filter((r) => r.status === "saved").length, skipped: rows.filter((r) => r.status === "skipped").length, errors: rows.filter((r) => r.status === "error").length, saving: rows.some((r) => r.status === "saving") };

  if (!row) return (
    <main className="mx-auto max-w-md px-4 pb-32 pt-[max(env(safe-area-inset-top),24px)] text-center">
      <h1 className="text-xl font-semibold">Revisão concluída</h1>
      <p className="mt-2 text-sm text-muted-foreground">{summary.saved} indicadas · {summary.skipped} puladas · {summary.errors} com erro{summary.saving ? " · salvando…" : ""}</p>
      <ul className="mt-5 space-y-2 text-left">{rows.map((r, i) => <li key={key(r.c)} className="flex items-center gap-3 rounded-xl border border-border p-2"><div className="w-9 shrink-0"><Poster path={r.c.posterPath} title={r.c.title} /></div><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{r.c.title}</p><p className="text-[11px] text-muted-foreground">{r.status === "saved" ? "Indicada" : r.status === "skipped" ? "Pulada" : r.status === "error" ? r.note : r.status === "saving" ? "Salvando…" : "Pendente"}{r.status === "saved" && r.note ? ` · ${r.note}` : ""}</p></div>{(r.status === "skipped" || r.status === "error" || r.status === "pending") && <Button variant="ghost" className="min-h-11 text-xs" onClick={() => { update(i, { status: "pending" }); go(i); }}>Rever</Button>}</li>)}</ul>
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
            {row.status !== "pending" && <p className="mt-2 text-xs text-muted-foreground">{row.status === "saved" ? "Indicada" : row.status === "skipped" ? "Pulada" : row.status === "saving" ? "Salvando…" : `Erro: ${row.note}`}</p>}
          </motion.section>
        </AnimatePresence>

        {row.status === "saved" || row.status === "saving" ? null : (
          <>
            <button type="button" aria-pressed={seen} onClick={() => setSeen((v) => !v)} className={`pressable mx-auto mt-5 flex min-h-11 items-center gap-2 rounded-full border px-4 text-xs ${seen ? "border-primary bg-primary/15 text-primary" : "border-border text-muted-foreground"}`}><Check className="h-4 w-4" />Já assisti antes</button>
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
