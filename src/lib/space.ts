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
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<SpaceInfo> => {
      // getSession reads the local session (no network); RLS still validates every query.
      const { data: sess } = await supabase.auth.getSession();
      const user = sess.session?.user;
      if (!user) throw new Error("Sessão expirada");
      const fallback: Person = {
        id: user.id,
        display_name: (user.user_metadata?.["full_name"] as string) ?? user.email ?? "Você",
        avatar_url: (user.user_metadata?.["avatar_url"] as string) ?? null,
      };
      // Profiles RLS only returns me + partner, so both queries can run in parallel.
      const [{ data: m, error: memberErr }, { data: profiles, error: pe }] = await Promise.all([
        supabase
          .from("space_members")
          .select("space_id")
          .eq("user_id", user.id)
          .limit(1)
          .maybeSingle(),
        supabase.from("profiles").select("id, display_name, avatar_url"),
      ]);
      // A failed read is an error, never "no space" (which would redirect to onboarding).
      if (memberErr) throw memberErr;
      if (pe) throw pe;
      if (!m)
        return {
          userId: user.id,
          email: user.email ?? "",
          spaceId: null,
          me: fallback,
          partner: null,
        };
      const me = profiles?.find((p) => p.id === user.id) ?? fallback;
      const partner = profiles?.find((p) => p.id !== user.id) ?? null;
      return { userId: user.id, email: user.email ?? "", spaceId: m.space_id, me, partner };
    },
  });
}

export function firstName(name: string | null | undefined) {
  return (name ?? "").split(" ")[0] || "Parceiro";
}

export type WatchSummary = {
  seen_count: number;
  last_watched_at: string | null;
  seen_keys: string[] | null;
};

/** Lightweight library summary shared by Home/Biblioteca/Galeria/Sorteio/Match.
 * Episode history comes pre-aggregated from the work_watch_summary view, never as raw events. */
export type LibraryWork = {
  id: string;
  title: string;
  original_title: string | null;
  media_type: "movie" | "tv";
  poster_path: string | null;
  backdrop_path: string | null;
  runtime_minutes: number | null;
  release_year: number | null;
  activity_at: string;
  created_at: string;
  genres: string[];
  interests: { user_id: string; reaction: Reaction }[];
  ratings: { user_id: string; score: number }[];
  indications: { indicated_by: string; created_at: string; renewed_at: string | null }[];
  joint_watch_sessions: { id: string; watched_at: string }[];
  watch: WatchSummary | null;
  series_states: { status: string; next_season: number | null; next_episode: number | null }[];
  work_metadata_cache: { logoPath?: string | null; logoChecked?: boolean; expires_at?: string; seasons: { episodeCount: number }[] | null }[];
};

export const libraryQueryOptions = (spaceId: string) => ({
  queryKey: ["library", spaceId] as const,
  staleTime: 60_000,
  queryFn: async (): Promise<LibraryWork[]> => {
    const { data, error } = await supabase
      .from("works")
      .select(
        "id, title, original_title, media_type, poster_path, backdrop_path, runtime_minutes, release_year, activity_at, created_at, genres, interests(user_id, reaction), ratings(user_id, score), indications(indicated_by, created_at, renewed_at), joint_watch_sessions(id, watched_at), work_watch_summary(seen_count, last_watched_at, seen_keys), series_states(status, next_season, next_episode), work_metadata_cache(seasons:payload->seasons,logoPath:payload->>logoPath,logoChecked:payload->logoChecked,expires_at)",
      )
      .eq("space_id", spaceId)
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
      watch: (arr(w["work_watch_summary"])[0] as WatchSummary | undefined) ?? null,
      series_states: arr(w["series_states"]),
      work_metadata_cache: arr(w["work_metadata_cache"]),
    })) as unknown as LibraryWork[];
  },
});

export function useLibrary(spaceId: string | null | undefined) {
  return useQuery({ ...libraryQueryOptions(spaceId ?? ""), enabled: !!spaceId });
}

export function isWatched(w: LibraryWork) {
  return w.joint_watch_sessions.length > 0 || (w.watch?.seen_count ?? 0) > 0;
}

/** Shown in Indicações: never watched, series in progress, or re-indicated after the last watch. */
export function isIndicated(w: LibraryWork) {
  // Works saved only as "Já assisti" (Descobrir) have no indication and never appear here.
  if (w.indications.length === 0) return false;
  if (!isWatched(w) || w.series_states[0]?.status === "watching") return true;
  const lastSession = w.joint_watch_sessions.reduce(
    (m, x) => Math.max(m, new Date(x.watched_at).getTime()),
    0,
  );
  const lastEp = w.watch?.last_watched_at ? new Date(w.watch.last_watched_at).getTime() : 0;
  const ind = w.indications.reduce(
    (mx, i) => Math.max(mx, new Date(i.renewed_at ?? i.created_at).getTime()),
    0,
  );
  return ind > Math.max(lastSession, lastEp);
}

export function seriesProgress(w: LibraryWork) {
  const seasons = (w.work_metadata_cache[0]?.seasons ?? []) as {
    seasonNumber?: number;
    episodeCount: number;
  }[];
  const total = seasons.reduce((a, s) => a + (s.episodeCount ?? 0), 0);
  const seen = new Set(w.watch?.seen_keys ?? []);
  let next: string | null = null;
  outer: for (const s of seasons) {
    for (let e = 1; e <= s.episodeCount; e++) {
      if (s.seasonNumber && !seen.has(`${s.seasonNumber}:${e}`)) {
        next = `T${s.seasonNumber}E${e}`;
        break outer;
      }
    }
  }
  if (!seasons.length) {
    const st = w.series_states[0];
    next = st?.next_season && st?.next_episode ? `T${st.next_season}E${st.next_episode}` : null;
  }
  return { seen: seen.size, total, next };
}
