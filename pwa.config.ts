// Build-only PWA step: writes manifest.webmanifest + sw.js into the client output.
// The SW precaches only versioned static assets; it has NO runtime caching and
// NO navigation fallback, so HTML, Supabase, auth, server functions, TMDB and
// Gemini always go to the network.
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Plugin } from "vite";

export const manifest = {
  id: "/",
  name: "AppCinema",
  short_name: "AppCinema",
  lang: "pt-BR",
  description: "Biblioteca privada de filmes e séries do casal.",
  start_url: "/",
  scope: "/",
  display: "standalone",
  orientation: "portrait-primary",
  theme_color: "#131217",
  background_color: "#131217",
  categories: ["entertainment", "lifestyle"],
  icons: [
    { src: "/pwa-192x192.png", sizes: "192x192", type: "image/png" },
    { src: "/pwa-512x512.png", sizes: "512x512", type: "image/png" },
    { src: "/maskable-512x512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
  ],
};

export function pwaPlugin(): Plugin {
  let outDir = "";
  return {
    name: "appcinema-pwa",
    apply: "build",
    applyToEnvironment: (env) => env.name === "client",
    configResolved(c) {
      outDir = c.build.outDir;
    },
    closeBundle: {
      sequential: true,
      order: "post",
      async handler() {
        if (!outDir) return;
        await writeFile(join(outDir, "manifest.webmanifest"), JSON.stringify(manifest, null, 2));
        const { generateSW } = await import("workbox-build");
        const res = await generateSW({
          globDirectory: outDir,
          swDest: join(outDir, "sw.js"),
          globPatterns: ["**/*.{js,css,woff,woff2,ttf,png,jpg,jpeg,svg,webp,webmanifest}"],
          globIgnores: ["sw.js", "workbox-*.js"],
          navigateFallback: undefined,
          runtimeCaching: [],
          cleanupOutdatedCaches: true,
          skipWaiting: false, // waits for the user to tap "Atualizar"
          clientsClaim: false,
          inlineWorkboxRuntime: true,
          mode: "production",
          sourcemap: false,
          maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        });
        console.log(`[pwa] sw.js: ${res.count} static files precached`);
      },
    },
  };
}
