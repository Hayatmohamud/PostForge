import type { PostDetailDto } from "../lib/contracts/api";
import { PostContent } from "./post-content";
import { PosterImage } from "./poster-image";
import { SourceList } from "./source-list";
import { StageTimeline } from "./stage-timeline";
import { VerificationSummary } from "./verification-summary";

const creationDateFormat = new Intl.DateTimeFormat("en", {
  dateStyle: "long",
  timeStyle: "short",
  timeZone: "UTC",
});

export function PostDetail({ post }: { post: PostDetailDto }) {
  // The public DTO intentionally excludes raw excerpts and corroborating IDs.
  // Supply an explicit omission notice to the existing evidence presentation.
  const evidence = post.evidence ? {
    sources: post.evidence.sources.map((source) => ({ ...source, fetchedEvidence: "" })),
    findings: post.evidence.findings.map((finding) => ({
      ...finding,
      evidence: "Source excerpts are unavailable.",
      corroboratingSourceIds: [],
    })),
  } : null;

  return (
    <section className="post-detail" aria-label="Completed post" data-testid="run-completion-slot">
      <header className="post-detail-meta">
        <p className="status status-success" role="status" data-testid="run-status">Complete · Your post is ready.</p>
        <p>Created <time dateTime={post.createdAt}>{creationDateFormat.format(new Date(post.createdAt))} UTC</time></p>
      </header>

      {post.poster ? (
        <PosterImage key={post.poster.posterId} posterId={post.poster.posterId} title={post.article?.title ?? post.topic} />
      ) : <p className="post-detail-notice" role="status">No poster is available for this saved post.</p>}

      {post.article ? (
        <>
          <PostContent article={post.article} />
          <SourceList sources={post.article.citedSources} />
        </>
      ) : (
        <div className="post-detail-notice" role="status">
          <h1>{post.topic}</h1>
          <p>The saved article is unavailable. Refresh this page to try loading it again.</p>
        </div>
      )}

      {evidence ? <VerificationSummary evidence={evidence} /> : <p className="post-detail-notice">No verification summary is available for this saved post.</p>}

      <details className="post-detail-stages">
        <summary>View completed generation stages</summary>
        <StageTimeline stages={post.stages} />
      </details>

      <style>{`
        .post-detail { width: min(100%, 58rem); min-width: 0; margin: 0 auto; }
        .post-detail-meta { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 0.5rem 1.5rem; margin-bottom: 1.5rem; }
        .post-detail-meta p { margin: 0; }
        .post-detail-meta > p:last-child { color: var(--color-text-muted); font-size: 0.85rem; }
        .post-detail h1 { overflow-wrap: anywhere; }
        .post-detail-notice { margin: 1.5rem 0; color: var(--color-text-muted); }
        .post-detail-stages { margin-top: 3rem; border-top: 1px solid var(--color-border); padding-top: 1rem; }
        .post-detail-stages > summary { width: fit-content; min-height: 2.75rem; padding: 0.65rem 0; color: var(--color-brand-dark); font-weight: 700; cursor: pointer; }
        .post-detail-stages[open] > summary { margin-bottom: 1rem; }
      `}</style>
    </section>
  );
}
