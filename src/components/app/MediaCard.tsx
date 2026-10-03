import { Link } from "@tanstack/react-router";
import { Film, Tv } from "lucide-react";
import { REACTION_EMOJI, tmdbImage } from "@/lib/format";
import { firstName, type LibraryWork, type SpaceInfo } from "@/lib/space";

export function Poster({
  path,
  title,
  className = "",
}: {
  path: string | null;
  title: string;
  className?: string;
}) {
  const src = tmdbImage(path);
  return src ? (
    <img
      src={src}
      alt={title}
      loading="lazy"
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

export function MediaCard({ work, space }: { work: LibraryWork; space: SpaceInfo }) {
  const mine = work.interests.find((i) => i.user_id === space.userId);
  const theirs = space.partner
    ? work.interests.find((i) => i.user_id === space.partner!.id)
    : undefined;
  return (
    <Link to="/work/$id" params={{ id: work.id }} className="block">
      <div className="relative">
        <Poster path={work.poster_path} title={work.title} />
        <span className="absolute left-2 top-2 rounded-md bg-background/80 p-1 text-muted-foreground">
          {work.media_type === "tv" ? (
            <Tv className="h-3.5 w-3.5" />
          ) : (
            <Film className="h-3.5 w-3.5" />
          )}
        </span>
      </div>
      <p className="mt-2 line-clamp-1 text-sm font-semibold">{work.title}</p>
      <p className="text-xs text-muted-foreground">
        Você {mine ? REACTION_EMOJI[mine.reaction] : "—"} |{" "}
        {space.partner ? firstName(space.partner.display_name) : "Parceiro"}{" "}
        {theirs ? REACTION_EMOJI[theirs.reaction] : "—"}
      </p>
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
