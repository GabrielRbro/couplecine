import { defineTool, ToolError } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "list_library",
  title: "Listar biblioteca",
  description: "Lista as obras (filmes e séries) da biblioteca do casal, mais recentes primeiro.",
  inputSchema: {
    media_type: z.enum(["movie", "tv"]).optional().describe("Filtrar por filme (movie) ou série (tv)."),
    query: z.string().trim().optional().describe("Trecho do título para filtrar."),
    limit: z.number().int().min(1).max(100).optional().describe("Máximo de obras (padrão 30)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ media_type, query, limit }, ctx) => {
    if (!ctx.isAuthenticated()) throw new ToolError("Não autenticado.");
    const sb = supabaseForUser(ctx);
    let q = sb
      .from("works")
      .select("id, media_type, tmdb_id, title, release_year, genres, runtime_minutes, activity_at")
      .order("activity_at", { ascending: false })
      .limit(limit ?? 30);
    if (media_type) q = q.eq("media_type", media_type);
    if (query) q = q.ilike("title", `%${query}%`);
    const { data, error } = await q;
    if (error) throw new ToolError(error.message);
    const works = (data ?? []).map((w) => ({
      id: w.id,
      media_type: String(w.media_type),
      tmdb_id: w.tmdb_id,
      title: w.title,
      release_year: w.release_year,
      genres: [...(w.genres ?? [])],
      runtime_minutes: w.runtime_minutes,
    }));
    return {
      content: [{ type: "text", text: JSON.stringify(works) }],
      structuredContent: { works },
    };
  },
});
