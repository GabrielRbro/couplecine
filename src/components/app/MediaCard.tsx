import { Link } from "@tanstack/react-router";
import { useRef, type CSSProperties } from "react";
import { Film, Tv } from "lucide-react";
import { REACTION_EMOJI, tmdbImage } from "@/lib/format";
import { markShared } from "@/lib/shared-transition";
import { firstName, type LibraryWork, type SpaceInfo } from "@/lib/space";

export function Poster({
  path,
  title,
  className = "",
  eager = false,
  transitionStyle,
}: {
  path: string | null;
  title: string;
  className?: string;
  eager?: boolean;
  transitionStyle?: CSSProperties;
}) {
  const src = tmdbImage(path);
  return src ? (
    <img
      src={src}
      style={transitionStyle}
      alt={title}
      loading={eager ? "eager" : "lazy"}
      decoding="async"
      className={`aspect-[2/3] w-full rounded-xl object-cover ${className}`}
    />
  ) : (
    <div
      className={`flex aspect-[2/3] w-full items-center justify-center rounded-xl bg-muted p-2 text-center text-xs text-muted-foreground ${className}`}
    >
      {title}
    </div>
  );
}

/** Dense library card: poster with title + mirrored reactions anchored inside a bottom gradient. */
export function MediaCard({ work, space }: { work: LibraryWork; space: SpaceInfo }) {
  const art = useRef<HTMLDivElement>(null);
  const mine = work.interests.find((i) => i.user_id === space.userId);
  const theirs = space.partner
    ? work.interests.find((i) => i.user_id === space.partner!.id)
    : undefined;
  const partner = space.partner ? firstName(space.partner.display_name) : "Parceiro";
  return (
    <Link
      to="/work/$id"
      params={{ id: work.id }}
      onClick={() => markShared(art.current, work.id, "poster")}
      aria-label={work.title}
      className="pressable block"
    >
      <div ref={art} className="relative overflow-hidden rounded-2xl art-edge">
        <Poster path={work.poster_path} title={work.title} className="rounded-2xl" />
        <span className="absolute left-2 top-2 rounded-md bg-background/60 p-1 text-muted-foreground backdrop-blur">
          {work.media_type === "tv" ? <Tv className="h-3 w-3" /> : <Film className="h-3 w-3" />}
        </span>
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-background via-background/80 to-transparent px-2.5 pb-2 pt-10">
          <p className="line-clamp-2 text-sm font-semibold leading-tight">{work.title}</p>
          <p className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="emoji" aria-label={`Você: ${mine?.reaction ?? "sem resposta"}`}>
              {mine ? REACTION_EMOJI[mine.reaction] : "·"}
            </span>
            <span className="h-3 w-px bg-border" />
            <span className="emoji" aria-label={`${partner}: ${theirs?.reaction ?? "sem resposta"}`}>
              {theirs ? REACTION_EMOJI[theirs.reaction] : "·"}
            </span>
          </p>
        </div>
      </div>
    </Link>
  );
}

export function EmptyState({ title, text }: { title: string; text?: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-border p-6 text-center">
      <p className="text-sm font-medium">{title}</p>
      {text && <p className="mt-1 text-xs text-muted-foreground">{text}</p>}
    </div>
  );
}
