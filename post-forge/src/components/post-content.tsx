import type { Article, ArticleBlock } from "../lib/contracts/post";
import { getSafeSourceUrl } from "./source-list";

export type PostContentProps = {
  article: Article;
};

function citationsForBlock(block: ArticleBlock, article: Article) {
  const sourcesById = new Map(article.citedSources.map((source) => [source.sourceId, source]));

  return block.sourceIds.map((sourceId, index) => {
    const source = sourcesById.get(sourceId);
    if (!source) return null;

    const safeUrl = getSafeSourceUrl(source.url);
    if (!safeUrl) {
      return <span className="article-citation article-citation-unavailable" key={`${sourceId}-${index}`}>[Source unavailable]</span>;
    }

    return (
      <a
        className="article-citation"
        data-source-id={source.sourceId}
        href={safeUrl}
        key={`${sourceId}-${index}`}
        rel="noreferrer noopener"
        target="_blank"
        title={`Source: ${source.title}`}
      >
        [{source.sourceId}]
      </a>
    );
  });
}

function renderBlock(block: ArticleBlock, article: Article, index: number) {
  const citations = citationsForBlock(block, article);
  const citationNote = citations.some(Boolean) ? <span className="article-citations" aria-label="Citations">{citations}</span> : null;

  if (block.type === "heading") {
    return <h2 key={`heading-${index}`}>{block.text}{citationNote}</h2>;
  }

  if (block.type === "list") {
    const items = block.text.split(/\r?\n/).filter((item) => item.trim().length > 0);
    return (
      <div className="article-list-block" key={`list-${index}`}>
        <ul>{(items.length ? items : [block.text]).map((item, itemIndex) => <li key={`${itemIndex}-${item}`}>{item}</li>)}</ul>
        {citationNote}
      </div>
    );
  }

  return <p key={`paragraph-${index}`}>{block.text}{citationNote}</p>;
}

export function PostContent({ article }: PostContentProps) {
  return (
    <article className="post-content" aria-labelledby="article-title">
      <header className="article-header">
        <p className="eyebrow">Sourced article</p>
        <h1 id="article-title">{article.title}</h1>
      </header>
      <div className="article-body">
        {article.body.map((block, index) => renderBlock(block, article, index))}
      </div>

      <style>{`
        .post-content { width: min(100%, 58rem); margin: 0 auto; min-width: 0; }
        .article-header { max-width: 48rem; margin-bottom: 2rem; }
        .article-body { max-width: 48rem; color: var(--color-text); font-family: Georgia, "Times New Roman", serif; font-size: 1.1rem; line-height: 1.75; overflow-wrap: anywhere; }
        .article-body h2 { margin: 2rem 0 0.7rem; font-family: Arial, Helvetica, sans-serif; font-size: clamp(1.25rem, 3vw, 1.65rem); }
        .article-body p { margin: 0 0 1.25rem; }
        .article-body ul { margin: 0 0 1.25rem; padding-left: 1.4rem; }
        .article-list-block { margin: 0 0 1.25rem; }
        .article-list-block ul { margin-bottom: 0.45rem; }
        .article-citations { display: inline-flex; flex-wrap: wrap; gap: 0.3rem; margin-left: 0.45rem; font-family: Arial, Helvetica, sans-serif; font-size: 0.75em; line-height: 1; vertical-align: super; }
        .article-citation { color: var(--color-brand-dark); font-weight: 750; text-decoration-thickness: 0.08em; text-underline-offset: 0.16em; }
        .article-citation-unavailable { color: var(--color-text-muted); font-size: 0.9em; font-weight: 650; }
      `}</style>
    </article>
  );
}
