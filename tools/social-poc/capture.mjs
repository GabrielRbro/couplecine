#!/usr/bin/env node
// Isolated, manually authenticated capture POC. No AppCinema DB access or credentials in code.
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { once } from "node:events";

const root = resolve(process.env.SOCIAL_POC_DIR || ".social-poc");
const HOME = { instagram: "https://www.instagram.com/", tiktok: "https://www.tiktok.com/" };
const MAX_VIDEO = 60 * 1024 * 1024;

export function canonical(raw) {
  const u = new URL(raw);
  if (u.protocol !== "https:" || u.username || u.password || u.port) throw new Error("URL não permitida");
  const host = u.hostname.toLowerCase();
  if (["www.instagram.com", "instagram.com"].includes(host)) {
    const m = u.pathname.match(/^\/(?:[\w.]{1,30}\/)?(reel|reels|p)\/([A-Za-z0-9_-]{5,40})\/?$/);
    if (m) return { platform: "instagram", url: `https://www.instagram.com/${m[1] === "p" ? "p" : "reel"}/${m[2]}/` };
  }
  if (["www.tiktok.com", "tiktok.com", "m.tiktok.com"].includes(host)) {
    const m = u.pathname.match(/^\/@([\w.-]{1,40})\/(video|photo)\/(\d{8,25})\/?$/);
    if (m) return { platform: "tiktok", url: `https://www.tiktok.com/@${m[1]}/${m[2]}/${m[3]}` };
  }
  throw new Error("Use o link completo de um Reel, post ou TikTok; encurtadores não entram nesta POC.");
}

async function command(program, args, timeoutMs = 90_000) {
  return new Promise((done) => {
    let output = "";
    const child = spawn(program, args, { stdio: ["ignore", "pipe", "pipe"] });
    const timer = setTimeout(() => { child.kill("SIGKILL"); output += " [timeout]"; }, timeoutMs);
    child.stdout.on("data", (b) => { output = (output + b.toString()).slice(-2000); });
    child.stderr.on("data", (b) => { output = (output + b.toString()).slice(-2000); });
    child.on("error", (e) => { clearTimeout(timer); done({ ok: false, reason: e.code === "ENOENT" ? `${program} indisponível` : e.message, output }); });
    child.on("close", (code) => { clearTimeout(timer); done({ ok: code === 0, reason: code === 0 ? null : `${program} falhou (código ${code})`, output }); });
  });
}

async function extractVisible(page) {
  return page.evaluate(() => {
    const text = (el) => (el?.textContent || "").trim().replace(/\s+/g, " ").slice(0, 4000);
    const meta = (key) => document.querySelector(`meta[property="${key}"]`)?.getAttribute("content")?.slice(0, 4000) || "";
    return {
      description: meta("og:description"),
      title: meta("og:title"),
      post: text(document.querySelector('[data-e2e="browse-video-desc"], article h1, article')),
      comments: [...document.querySelectorAll('[data-e2e="comment-level-1"], article ul ul li')].slice(0, 8).map(text).filter(Boolean),
    };
  });
}

async function sampleVideo(page, temp) {
  const video = page.locator("video").first();
  if (!await video.count()) return { status: "no_video", subtitles: [], frames: [] };
  const subtitles = new Set();
  const frames = [];
  const duration = await video.evaluate((v) => Number.isFinite(v.duration) ? v.duration : 0).catch(() => 0);
  for (const second of [0, 2, 5, 10, 20].filter((s) => !duration || s < duration)) {
    try {
      await video.evaluate((v, t) => { v.currentTime = t; v.muted = true; void v.play().catch(() => {}); }, second);
      await page.waitForTimeout(500);
      const lines = await page.evaluate(() => {
        const v = document.querySelector("video");
        const cues = [...(v?.textTracks || [])].flatMap((track) => [...(track.activeCues || [])].map((cue) => cue.text || ""));
        const overlays = [...document.querySelectorAll('[data-e2e*="caption"], [class*="Subtitle"], [class*="subtitle"]')].map((el) => el.textContent || "");
        return [...cues, ...overlays].map((s) => s.trim()).filter(Boolean).slice(0, 10);
      });
      lines.forEach((line) => subtitles.add(line.slice(0, 500)));
      const frame = join(temp, `frame-${second}.png`);
      await video.screenshot({ path: frame, timeout: 5000 });
      const ocr = await command("tesseract", [frame, "stdout", "-l", "por+eng"], 12_000);
      frames.push({ second, ocr: ocr.ok ? ocr.output?.slice(0, 1500) || "" : null, status: ocr.ok ? "ok" : ocr.reason });
    } catch { frames.push({ second, status: "frame_unavailable" }); }
  }
  return { status: "sampled", duration, subtitles: [...subtitles], frames };
}

async function mediaAudio(context, url, temp) {
  const jar = join(temp, "cookies.txt");
  const cookies = await context.cookies();
  // Netscape cookie jar exists only in the temporary directory and is deleted in finally.
  const lines = cookies.filter((c) => !/[\t\r\n]/.test(c.name + c.value + c.domain + c.path)).map((c) =>
    `${c.httpOnly ? "#HttpOnly_" : ""}${c.domain}\t${c.domain.startsWith(".") ? "TRUE" : "FALSE"}\t${c.path}\t${c.secure ? "TRUE" : "FALSE"}\t${Math.max(0, Math.trunc(c.expires))}\t${c.name}\t${c.value}`);
  await writeFile(jar, `# Netscape HTTP Cookie File\n${lines.join("\n")}\n`, { mode: 0o600 });
  await chmod(jar, 0o600);
  const output = join(temp, "source.%(ext)s");
  const dl = await command("yt-dlp", ["--no-playlist", "--no-progress", "--retries", "0", "--socket-timeout", "15", "--max-filesize", "60M", "--cookies", jar, "-o", output, url], 90_000);
  if (!dl.ok) return { status: dl.reason, transcript: null };
  const { readdir, stat } = await import("node:fs/promises");
  const file = (await readdir(temp)).find((n) => n.startsWith("source."));
  if (!file || (await stat(join(temp, file))).size > MAX_VIDEO) return { status: "video_too_large", transcript: null };
  const wav = join(temp, "audio.wav");
  const audio = await command("ffmpeg", ["-nostdin", "-loglevel", "error", "-i", join(temp, file), "-t", "60", "-ac", "1", "-ar", "16000", wav], 30_000);
  if (!audio.ok) return { status: audio.reason, transcript: null };
  const model = process.env.WHISPER_MODEL;
  if (!model) return { status: "audio_extracted_no_whisper_model", transcript: null };
  const outputPrefix = join(temp, "transcript");
  const transcribe = await command("whisper-cli", ["-m", model, "-f", wav, "-otxt", "-of", outputPrefix], 90_000);
  if (!transcribe.ok) return { status: transcribe.reason, transcript: null };
  const { readFile } = await import("node:fs/promises");
  return { status: "transcribed", transcript: (await readFile(`${outputPrefix}.txt`, "utf8")).slice(0, 6000) };
}

async function main() {
  const [action, input] = process.argv.slice(2);
  if (!["login", "capture"].includes(action)) throw new Error("Uso: npm run login -- instagram|tiktok  OU  npm run capture -- URL");
  const ref = action === "capture" ? canonical(input) : { platform: input, url: HOME[input] };
  if (!ref.url) throw new Error("Plataforma inválida: instagram ou tiktok");
  const profile = join(root, "profiles", ref.platform);
  const context = await chromium.launchPersistentContext(profile, { headless: action === "capture" && process.argv.includes("--headless"), viewport: { width: 430, height: 900 } });
  try {
    const page = context.pages()[0] || await context.newPage();
    await page.goto(ref.url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    if (action === "login") {
      process.stdout.write(`Faça login na conta dedicada de ${ref.platform} no navegador aberto. Pressione Enter depois.\n`);
      await once(process.stdin.resume(), "data");
      return;
    }
    const temp = await mkdtemp(join(tmpdir(), "appcinema-social-"));
    try {
      await page.waitForTimeout(1500);
      const loginRequired = /\/accounts\/login|\/login/.test(page.url()) || await page.locator('input[type="password"]').count() > 0;
      const report = { url: ref.url, platform: ref.platform, capturedAt: new Date().toISOString(), status: loginRequired ? "login_required" : "captured", evidence: null, video: null, audio: null };
      if (!loginRequired) {
        report.evidence = await extractVisible(page);
        report.video = await sampleVideo(page, temp);
        report.audio = await mediaAudio(context, ref.url, temp);
      }
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    } finally { await rm(temp, { recursive: true, force: true }); }
  } finally { await context.close(); }
}

if (process.argv[1]?.endsWith("capture.mjs")) main().catch((e) => { console.error(e.message); process.exitCode = 1; });
