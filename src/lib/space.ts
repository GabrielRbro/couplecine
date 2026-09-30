import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Reaction } from "./format";

export type Person = { id: string; display_name: string; avatar_url: string | null };

export type SpaceInfo = {
  userId: string;
  email: string;
  spaceId: string | null;
  me: Person;
  partner: Person | null;
};

export function useSpace() {
  return useQuery({
    queryKey: ["space"],
    staleTime: 60_000,
    queryFn: async (): Promise<SpaceInfo> => {
      const { data: auth } = await supabase.auth.getUser();
      const user = auth.user;
      if (!user) throw new Error("Sessão expirada");
      const fallback: Person = {
        id: user.id,
        display_name: (user.user_metadata?.["full_name"] as string) ?? user.email ?? "Você",
        avatar_url: (user.user_metadata?.["avatar_url"] as string) ?? null,
      };
      const { data: m } = await supabase
        .from("space_members")
        .select("space_id")
        .eq("user_id", user.id)
        .limit(1)
        .maybeSingle();
      if (!m) return { userId: user.id, email: user.email ?? "", spaceId: null, me: fallback, partner: null };
      const { data: members } = await supabase.from("space_members").select("user_id").eq("space_id", m.space_id);
      const ids = (members ?? []).map((x) => x.user_id);
      const { data: profiles } = await supabase.from("profiles").select("id, display_name, avatar_url").in("id", ids);
      const me = profiles?.find((p) => p.id === user.id) ?? fallback;
      const partner = profiles?.find((p) => p.id !== user.id) ?? null;
      return { userId: user.id, email: user.email ?? "", spaceId: m.space_id, me, partner };
    },
  });
}

export function firstName(name: string | null | undefined) {
  return (name ?? "").split(" ")[0] || "Parceiro";
}

export type LibraryWork = {
  id: string;
  title: string;
  original_title: string | null;
  media_type: "movie" | "tv";
  poster_path: string | null;
  release_year: number | null;
  activity_at: string;
  created_at: string;
  genres: string[];
  interests: { user_id: string; reaction: Reaction }[];
  ratings: { user_id: string; score: number }[];
  indications: { indicated_by: string; created_at: string }[];
  joint_watch_sessions: { id: string; watched_at: string }[];
  watch_events: { id: string; watched_at: string }[];
  series_states: { status: string }[];
};

export function useLibrary(spaceId: string | null | undefined) {
  return useQuery({
    queryKey: ["library", spaceId],
    enabled: !!spaceId,
    queryFn: async (): Promise<LibraryWork[]> => {
      const { data, error } = await supabase
        .from("works")
        .select(
          "id, title, original_title, media_type, poster_path, release_year, activity_at, created_at, genres, interests(user_id, reaction), ratings(user_id, score), indications(indicated_by, created_at), joint_watch_sessions(id, watched_at), watch_events(id, watched_at), series_states(status)",
        )
        .eq("space_id", spaceId!)
        .order("activity_at", { ascending: false });
      if (error) throw error;
      // One-to-one relations come back as an object or null; normalize to arrays.
      const arr = (v: unknown) => (Array.isArray(v) ? v : v ? [v] : []);
      return ((data ?? []) as unknown as Record<string, unknown>[]).map((w) => ({
        ...w,
        interests: arr(w["interests"]),
        ratings: arr(w["ratings"]),
        indications: arr(w["indications"]),
        joint_watch_sessions: arr(w["joint_watch_sessions"]),
        watch_events: arr(w["watch_events"]),
        series_states: arr(w["series_states"]),
      })) as unknown as LibraryWork[];
    },
  });
}

export function isWatched(w: LibraryWork) {
  return w.joint_watch_sessions.length > 0 || w.watch_events.length > 0;
}

/** Shown in Indicações: never watched, series in progress, or re-indicated after the last watch. */
export function isIndicated(w: LibraryWork) {
  if (!isWatched(w) || w.series_states[0]?.status === "watching") return true;
  const last = (xs: { watched_at?: string; created_at?: string }[], k: "watched_at" | "created_at") =>
    xs.reduce((m, x) => Math.max(m, new Date((x as Record<string, string>)[k] ?? 0).getTime()), 0);
  return last(w.indications, "created_at") > Math.max(last(w.joint_watch_sessions, "watched_at"), last(w.watch_events, "watched_at"));
}
