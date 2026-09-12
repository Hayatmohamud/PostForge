"use client";

import Image from "next/image";
import { useState } from "react";

export function PosterImage({ posterId, title }: { posterId: string; title: string }) {
  const [status, setStatus] = useState<"loading" | "loaded" | "error">("loading");

  return (
    <figure className="poster-image">
      <div className="poster-frame" aria-busy={status === "loading"}>
        {status !== "error" ? (
          <Image
            src={`/api/posters/${encodeURIComponent(posterId)}`}
            alt={`Generated poster accompanying “${title}”`}
            fill
            sizes="(max-width: 960px) 100vw, 928px"
            unoptimized
            loading="eager"
            className={status === "loaded" ? "poster-loaded" : "poster-pending"}
            onLoad={() => setStatus("loaded")}
            onError={() => setStatus("error")}
          />
        ) : null}
        {status === "loading" ? <p className="poster-notice" role="status">Loading poster…</p> : null}
        {status === "error" ? (
          <p className="poster-notice" role="status">The poster could not be loaded. The article and its sources are still available below.</p>
        ) : null}
      </div>
      <figcaption>Generated illustration for this article.</figcaption>
      <style>{`
        .poster-image { margin: 0 0 2.5rem; min-width: 0; }
        .poster-frame { position: relative; display: grid; place-items: center; aspect-ratio: 16 / 9; overflow: hidden; border: 1px solid var(--color-border); border-radius: var(--radius-sm); background: var(--color-surface-muted); }
        .poster-frame img { object-fit: contain; }
        .poster-pending { opacity: 0; }
        .poster-loaded { opacity: 1; }
        .poster-notice { position: relative; max-width: 30rem; margin: 0; padding: 1.25rem; color: var(--color-text-muted); text-align: center; }
        .poster-image figcaption { margin-top: 0.6rem; color: var(--color-text-muted); font-size: 0.8rem; }
      `}</style>
    </figure>
  );
}
