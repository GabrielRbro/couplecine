import { auth, defineMcp } from "@lovable.dev/mcp-js";
import listLibrary from "./tools/list-library";
import getWork from "./tools/get-work";

const projectRef = import.meta.env["VITE_SUPABASE_PROJECT_ID"] ?? "project-ref-unset";

export default defineMcp({
  name: "cinema-guide",
  title: "Cinema Guide",
  version: "0.1.0",
  instructions:
    "Ferramentas somente leitura da biblioteca privada de filmes e séries do casal. Use `list_library` para buscar obras e `get_work` para detalhes, reações e notas.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [listLibrary, getWork],
});
