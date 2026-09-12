"use client";

import Link from "next/link";
import type { PostStatus } from "../lib/contracts/post";
import { usePost } from "../hooks/use-post";
import { StageTimeline } from "./stage-timeline";
import { PostDetail } from "./post-detail";

const statusCopy: Readonly<Record<PostStatus, string>> = {
  queued: "Your run is queued.",
  researching: "Research is underway.",
  verifying: "Sources are being verified.",
  writing: "The article is being written.",
  editing: "The draft is being edited.",
  illustrating: "A supporting illustration is being prepared.",
  publishing: "The finished post is being saved.",
  done: "Your post is ready.",
  failed: "Generation stopped before the post was complete.",
};

const statusLabels: Readonly<Record<PostStatus, string>> = {
  queued: "Queued",
  researching: "Researching",
  verifying: "Verifying",
  writing: "Writing",
  editing: "Editing",
  illustrating: "Illustrating",
  publishing: "Publishing",
  done: "Complete",
  failed: "Failed",
};

function LoadingState() {
  return (
    <section className="run-state" aria-labelledby="run-loading-heading" data-testid="run-loading">
      <p className="eyebrow">Live run</p>
      <h1 id="run-loading-heading">Loading your post…</h1>
      <p className="run-state-copy">We’re retrieving the latest saved progress.</p>
      <style>{runStateStyles}</style>
    </section>
  );
}

function UnavailableState({ notFound, retryable }: { notFound: boolean; retryable: boolean }) {
  return (
    <section className="run-state run-state-error" aria-labelledby="run-error-heading" data-testid={notFound ? "run-not-found" : "run-fetch-error"}>
      <p className="eyebrow">Live run</p>
      <h1 id="run-error-heading">{notFound ? "We couldn’t find that post." : "We couldn’t load this run."}</h1>
      <p className="run-state-copy">
        {notFound
          ? "The link may be out of date, or the post may not exist."
          : retryable
            ? "We’ll keep trying when the connection is temporary. You can also start a new post."
            : "This run could not be loaded. You can start a new post instead."}
      </p>
      <Link className="button button-secondary" href="/">New post</Link>
      <style>{runStateStyles}</style>
    </section>
  );
}

export function RunView({ postId }: { postId: string }) {
  const snapshot = usePost(postId);
  const post = snapshot.post;

  if (!post) {
    if (snapshot.phase === "loading" || snapshot.phase === "idle") return <LoadingState />;
    return <UnavailableState notFound={snapshot.fetchError?.status === 404} retryable={snapshot.fetchError?.retryable === true} />;
  }

  if (post.status === "done") return <PostDetail post={post} />;

  const isGenerationFailure = post.status === "failed";
  const showingPersistedProgress = snapshot.phase === "fetch-error";

  return (
    <section className="run-view" aria-labelledby="run-heading">
      <div className="run-heading">
        <div>
          <p className="eyebrow">Live run</p>
          <h1 id="run-heading">{post.topic}</h1>
        </div>
        <p className="run-intro">Your saved progress stays available while the pipeline works through each stage.</p>
      </div>

      {showingPersistedProgress ? (
        <div className="run-transport-warning" role="status" data-testid="run-transport-warning">
          We can’t reach PostForge right now. Showing the last saved progress while we reconnect.
        </div>
      ) : null}

      <div className="run-status-card surface-card">
        <div>
          <p className="run-status-label" data-testid="run-status">{statusLabels[post.status]}</p>
          <p className="run-status-message">{statusCopy[post.status]}</p>
        </div>
        {isGenerationFailure ? (
          <div className="run-failure" role="alert" data-testid="run-generation-failure">
            <p>{post.error?.message ?? "Generation failed before a final result was saved."}</p>
            {post.error?.stage ? <p>Stopped during {post.error.stage}.</p> : null}
            <p>{post.error?.retryable ? "The workflow may retry this step automatically." : "Start a new post to try again."}</p>
            <Link className="button button-secondary" href="/">New post</Link>
          </div>
        ) : null}
      </div>

      <StageTimeline stages={post.stages} />

      <style>{`
        .run-view { width: min(100%, 58rem); margin: 0 auto; }
        .run-heading { display: grid; grid-template-columns: minmax(0, 1.15fr) minmax(14rem, 0.85fr); align-items: end; gap: 2rem; margin-bottom: 2.25rem; }
        .run-heading h1 { overflow-wrap: anywhere; }
        .run-intro { margin: 0 0 0.35rem; color: var(--color-text-muted); font-size: 1.05rem; }
        .run-transport-warning { margin-bottom: 1rem; padding: 0.8rem 1rem; border: 1px solid #ead6ad; border-radius: var(--radius-sm); background: #fffaf0; color: var(--color-warning); }
        .run-status-card { display: grid; gap: 1.25rem; margin-bottom: 2.25rem; padding: clamp(1.25rem, 4vw, 2rem); }
        .run-status-label { margin: 0 0 0.35rem; color: var(--color-brand); font-size: 0.8rem; font-weight: 750; letter-spacing: 0.08em; text-transform: uppercase; }
        .run-status-message { margin: 0; font-size: 1.25rem; font-weight: 700; }
        .run-failure { display: grid; gap: 0.65rem; padding-top: 1rem; border-top: 1px solid var(--color-border); }
        .run-failure { color: var(--color-error); }
        .run-failure p { margin: 0; }
        .run-failure .button { width: fit-content; color: var(--color-text); }
        @media (max-width: 680px) {
          .run-heading { display: block; }
          .run-intro { margin-top: 1rem; }
        }
      `}</style>
    </section>
  );
}

const runStateStyles = `
  .run-state { width: min(100%, 42rem); margin: 0 auto; padding: clamp(2rem, 8vw, 5rem) 0; }
  .run-state h1 { max-width: 15ch; }
  .run-state-copy { color: var(--color-text-muted); font-size: 1.05rem; }
  .run-state-error { padding-bottom: 2rem; }
  .run-state-error .button { margin-top: 0.5rem; }
`;
