// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { mcpPlugin } from "@lovable.dev/mcp-js/stacks/tanstack/vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  vite: {
    plugins: [
      mcpPlugin(),
      VitePWA({
        registerType: "prompt", // user taps "Atualizar"; never reload mid-use
        injectRegister: null, // src/lib/pwa.ts is the only registrar
        devOptions: { enabled: false },
        filename: "sw.js",
        manifestFilename: "manifest.webmanifest",
        includeAssets: ["favicon.png", "apple-touch-icon.png"],
        manifest: {
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
        },
        workbox: {
          // Only versioned static build assets. No HTML, no runtime caching:
          // Supabase, auth, server functions, TMDB and Gemini always hit the network.
          globPatterns: ["**/*.{js,css,woff,woff2,ttf,png,jpg,jpeg,svg,webp,ico,webmanifest}"],
          globIgnores: ["**/server/**", "**/_server/**"],
          navigateFallback: null,
          runtimeCaching: [],
          cleanupOutdatedCaches: true,
          clientsClaim: false,
          skipWaiting: false,
          maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        },
      }),
    ],
  },
});
