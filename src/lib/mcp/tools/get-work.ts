import { defineTool, ToolError } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "get_work",
  title: "Detalhes da obra",
  description: "Mostra uma obra da biblioteca com sinopse, reações e notas do casal.",
  inputSchema: { id: z.string().uuid().describe("ID da obra (de list_library).") },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ id }, ctx) => {
    if (!ctx.isAuthenticated()) throw new ToolError("Não autenticado.");
    const sb = supabaseForUser(ctx);
    const me = ctx.getUserId();
    const [w, i, r] = await Promise.all([
      sb.from("works").select("id, media_type, title, release_year, overview, genres, runtime_minutes").eq("id", id).maybeSingle(),
      sb.from("interests").select("user_id, reaction").eq("work_id", id),
      sb.from("ratings").select("user_id, score").eq("work_id", id),
    ]);
    if (w.error) throw new ToolError(w.error.message);
    if (!w.data) throw new ToolError("Obra não encontrada.");
    const work = {
      id: w.data.id,
      media_type: String(w.data.media_type),
      title: w.data.title,
      release_year: w.data.release_year,
      overview: w.data.overview,
      genres: [...(w.data.genres ?? [])],
      runtime_minutes: w.data.runtime_minutes,
      interests: (i.data ?? []).map((x) => ({ who: x.user_id === me ? "eu" : "parceiro", reaction: String(x.reaction) })),
      ratings: (r.data ?? []).map((x) => ({ who: x.user_id === me ? "eu" : "parceiro", score: Number(x.score) })),
    };
    return { content: [{ type: "text", text: JSON.stringify(work) }], structuredContent: { work } };
  },
});
