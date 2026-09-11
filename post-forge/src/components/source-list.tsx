import type { Source, SourceReference } from "../lib/contracts/evidence";

export type CitationSource = Pick<Source | SourceReference, "sourceId" | "url" | "title">;

const sourceIdPattern = /[^A-Za-z0-9_-]/g;

/** Keep source links limited to the public URL shape accepted by the API. */
export function getSafeSourceUrl(value: string): string | null {
  try {
    const parsed = new URL(value);
    const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    const isPrivateHostname = hostname === "localhost"
      || hostname.endsWith(".localhost")
      || hostname === "::1"
      || /^(127\.|10\.|192\.168\.|169\.254\.)/.test(hostname)
      || /^172\.(?:1[6-9]|2\d|3[01])\./.test(hostname);

    if ((parsed.protocol !== "https:" && parsed.protocol !== "http:")
      || parsed.username
      || parsed.password
      || !hostname
      || isPrivateHostname) {
      return null;
    }

    return value;
  } catch {
    return null;
  }
}

export function sourceAnchorId(sourceId: string): string {
  return `source-${sourceId.replace(sourceIdPattern, "-")}`;
}

function getSourceDomain(url: string): string | null {
  const safeUrl = getSafeSourceUrl(url);
  if (!safeUrl) return null;

  try {
    return new URL(safeUrl).hostname;
  } catch {
    return null;
  }
}

function uniqueSources(sources: readonly CitationSource[]): CitationSource[] {
  const seen = new Set<string>();
  return sources.filter((source) => {
    if (seen.has(source.sourceId)) return false;
    seen.add(source.sourceId);
    return true;
  });
}

export type SourceListProps = {
  sources: readonly CitationSource[];
};

export function SourceList({ sources }: SourceListProps) {
  const visibleSources = uniqueSources(sources);

  return (
    <section className="source-list" aria-labelledby="sources-heading">
      <div className="source-list-header">
        <div>
          <p className="eyebrow">Traceable evidence</p>
          <h2 id="sources-heading">Sources</h2>
        </div>
        <p className="source-list-intro">Public references used by this article.</p>
      </div>

      {visibleSources.length ? (
        <ol className="source-items">
          {visibleSources.map((source) => {
            const safeUrl = getSafeSourceUrl(source.url);
            const domain = getSourceDomain(source.url);

            return (
              <li className="source-item" id={sourceAnchorId(source.sourceId)} key={source.sourceId}>
                <div className="source-item-heading">
                  <span className="source-number" aria-hidden="true">{visibleSources.indexOf(source) + 1}</span>
                  <h3>{source.title}</h3>
                </div>
                {domain ? <p className="source-domain">{domain}</p> : <p className="source-domain source-muted">Domain unavailable</p>}
                {safeUrl ? (
                  <a className="source-link" href={safeUrl} target="_blank" rel="noreferrer noopener">
                    <span className="source-url">{safeUrl}</span>
                    <span className="source-link-label">Open source</span>
                  </a>
                ) : (
                  <p className="source-unavailable">This source link is unavailable.</p>
                )}
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="source-empty">No article sources were cited.</p>
      )}

      <style>{`
        .source-list { width: min(100%, 58rem); margin: 2.5rem auto 0; min-width: 0; }
        .source-list-header { display: flex; align-items: end; justify-content: space-between; gap: 2rem; margin-bottom: 1rem; }
        .source-list-header .eyebrow { margin-bottom: 0.55rem; }
        .source-list-intro { max-width: 20rem; margin: 0 0 0.2rem; color: var(--color-text-muted); font-size: 0.95rem; }
        .source-items { display: grid; gap: 0.75rem; margin: 0; padding: 0; list-style: none; }
        .source-item { min-width: 0; padding: 1rem 1.1rem; border: 1px solid var(--color-border); border-radius: var(--radius-md, 0.875rem); background: var(--color-surface); box-shadow: 0 0.75rem 2rem rgb(23 32 51 / 0.035); }
        .source-item-heading { display: flex; align-items: start; gap: 0.65rem; }
        .source-item h3 { min-width: 0; font-size: 1rem; letter-spacing: -0.015em; overflow-wrap: anywhere; }
        .source-number { display: grid; flex: 0 0 1.5rem; width: 1.5rem; height: 1.5rem; place-items: center; border-radius: 50%; background: var(--color-surface-muted); color: var(--color-brand-dark); font-size: 0.75rem; font-weight: 750; }
        .source-domain { margin: 0.55rem 0 0; color: var(--color-text-muted); font-size: 0.82rem; }
        .source-muted, .source-empty, .source-unavailable { color: var(--color-text-muted); }
        .source-link { display: flex; align-items: baseline; justify-content: space-between; gap: 1rem; margin-top: 0.6rem; color: var(--color-brand-dark); font-size: 0.85rem; }
        .source-url { min-width: 0; overflow-wrap: anywhere; }
        .source-link-label { flex: 0 0 auto; font-weight: 700; white-space: nowrap; }
        .source-unavailable { margin: 0.6rem 0 0; font-size: 0.85rem; }
        .source-empty { margin: 0; }
        @media (max-width: 600px) {
          .source-list-header { display: block; }
          .source-list-intro { margin-top: 0.7rem; }
          .source-link { display: block; }
          .source-link-label { display: block; margin-top: 0.35rem; }
        }
      `}</style>
    </section>
  );
}
