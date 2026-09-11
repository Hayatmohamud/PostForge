"use client";

/* The native image event is required to render the thumbnail fallback on load failure. */
/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import { useState } from "react";
import type { PostListItem } from "../lib/contracts/api";

type PostListProps = {
  posts: PostListItem[];
  error: string | null;
  hasMore: boolean;
  isLoading: boolean;
  isLoadingMore: boolean;
  onLoadMore: () => void;
  onRetry: () => void;
};

const statusLabels: Record<PostListItem["status"], string> = {
  queued: "Queued",
  researching: "Researching",
  verifying: "Verifying",
  writing: "Writing",
  editing: "Editing",
  illustrating: "Illustrating",
  publishing: "Publishing",
  done: "Completed",
  failed: "Failed",
};

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date unavailable";
  return new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "numeric" }).format(date);
}

function PostThumbnail({ posterId }: { posterId?: string }) {
  const [failed, setFailed] = useState(false);
  if (!posterId || failed) return <span className="post-thumbnail post-thumbnail-fallback" aria-hidden="true">No thumbnail</span>;

  return (
    <img
      className="post-thumbnail"
      src={`/api/posters/${posterId}`}
      alt=""
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
    />
  );
}

export function PostList({ posts, error, hasMore, isLoading, isLoadingMore, onLoadMore, onRetry }: PostListProps) {
  if (isLoading && posts.length === 0) {
    return <p className="library-state" role="status" aria-live="polite" data-testid="library-loading">Loading past posts…</p>;
  }

  if (error && posts.length === 0) {
    return (
      <div className="library-state library-state-error" role="alert" data-testid="library-error">
        <p>{error}</p>
        <button className="button button-secondary" type="button" onClick={onRetry}>Try again</button>
      </div>
    );
  }

  if (posts.length === 0) {
    return (
      <div className="library-state" data-testid="library-empty">
        <h2>No past posts yet</h2>
        <p>Your published and in-progress posts will appear here.</p>
        <Link className="button button-primary" href="/">Create a post</Link>
      </div>
    );
  }

  return (
    <>
      <div className="post-list-container">
      {isLoading ? <p className="library-refreshing" role="status" aria-live="polite">Refreshing library…</p> : null}
      {error ? (
        <div className="library-inline-error" role="alert">
          <span>{error}</span>
          <button className="button button-quiet" type="button" onClick={onRetry}>Try again</button>
        </div>
      ) : null}
      <ul className="post-list" aria-label="Past posts">
        {posts.map((post) => (
          <li className="post-list-item" key={post.postId}>
            <Link className="post-list-link" href={`/posts/${post.postId}`} aria-label={`Open post: ${post.topic}`}>
              <PostThumbnail posterId={post.posterId} />
              <span className="post-list-content">
                <span className="post-list-label">Topic</span>
                <h2>{post.topic}</h2>
                <span className="post-list-meta">
                  <span className="post-status" data-status={post.status}>{statusLabels[post.status]}</span>
                  <time dateTime={post.createdAt}>Created {formatDate(post.createdAt)}</time>
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {hasMore ? (
        <div className="post-list-actions">
          <button className="button button-secondary" type="button" onClick={onLoadMore} disabled={isLoadingMore}>
            {isLoadingMore ? "Loading more…" : "Load more posts"}
          </button>
        </div>
      ) : null}
      </div>
      <style jsx>{`
        .library-state { display: grid; justify-items: start; gap: 0.9rem; padding: clamp(1.5rem, 5vw, 3rem); border: 1px dashed var(--color-border); border-radius: var(--radius-md, 0.875rem); background: rgb(255 255 255 / 0.55); color: var(--color-text-muted); }
        .library-state p, .library-state h2 { margin: 0; }
        .library-state h2 { color: var(--color-text); font-size: 1.35rem; }
        .library-state-error { border-style: solid; border-color: #f2c5c0; background: #fff8f7; color: var(--color-error); }
        .post-list-container { display: grid; gap: 1rem; }
        .library-refreshing { margin: 0; color: var(--color-text-muted); font-size: 0.875rem; }
        .library-inline-error { display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding: 0.8rem 1rem; border-radius: var(--radius-sm); background: #fff8f7; color: var(--color-error); font-size: 0.875rem; }
        .library-inline-error .button { min-height: auto; padding: 0.25rem; }
        .post-list { display: grid; gap: 0.85rem; margin: 0; padding: 0; list-style: none; }
        .post-list-item { min-width: 0; }
        .post-list-link { display: grid; grid-template-columns: 7rem minmax(0, 1fr); align-items: stretch; gap: 1rem; min-height: 8rem; padding: 0.85rem; border: 1px solid var(--color-border); border-radius: var(--radius-md, 0.875rem); background: var(--color-surface); text-decoration: none; transition: border-color 160ms ease, box-shadow 160ms ease, transform 160ms ease; }
        .post-list-link:hover { border-color: var(--color-brand); box-shadow: 0 0.5rem 1.5rem rgb(23 32 51 / 0.08); transform: translateY(-1px); }
        .post-thumbnail { display: block; width: 7rem; height: 6.25rem; border-radius: var(--radius-sm); object-fit: cover; background: var(--color-surface-muted); }
        .post-thumbnail-fallback { display: grid; place-items: center; padding: 0.5rem; color: var(--color-text-muted); font-size: 0.75rem; text-align: center; }
        .post-list-content { display: grid; min-width: 0; align-content: center; gap: 0.45rem; }
        .post-list-label { color: var(--color-brand); font-size: 0.75rem; font-weight: 750; letter-spacing: 0.08em; text-transform: uppercase; }
        .post-list-content h2 { overflow-wrap: anywhere; color: var(--color-text); font-size: clamp(1.1rem, 2.5vw, 1.45rem); }
        .post-list-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 0.65rem 1rem; color: var(--color-text-muted); font-size: 0.85rem; }
        .post-status { display: inline-flex; align-items: center; min-height: 1.7rem; padding: 0.25rem 0.55rem; border-radius: 999px; background: var(--color-surface-muted); color: var(--color-text-muted); font-weight: 700; }
        .post-status[data-status="done"] { background: #e6f5ee; color: var(--color-success); }
        .post-status[data-status="failed"] { background: #fdebe9; color: var(--color-error); }
        .post-status[data-status="queued"] { background: #e8f2fc; color: var(--color-info); }
        .post-list-actions { display: flex; justify-content: center; padding-top: 0.5rem; }
        @media (max-width: 480px) {
          .post-list-link { grid-template-columns: 4.5rem minmax(0, 1fr); gap: 0.75rem; min-height: 6rem; padding: 0.65rem; }
          .post-thumbnail { width: 4.5rem; height: 4.5rem; }
          .post-list-meta { align-items: flex-start; flex-direction: column; gap: 0.45rem; }
        }
        @media (prefers-reduced-motion: reduce) {
          .post-list-link { transition: none; }
        }
      `}</style>
    </>
  );
}
