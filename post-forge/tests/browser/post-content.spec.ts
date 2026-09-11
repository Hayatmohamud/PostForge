import { expect, test } from "@playwright/test";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PostContent } from "../../src/components/post-content";
import { SourceList } from "../../src/components/source-list";
import { VerificationSummary } from "../../src/components/verification-summary";
import type { EvidenceBundle } from "../../src/lib/contracts/evidence";
import type { Article } from "../../src/lib/contracts/post";

const articleSource = {
  sourceId: "source-alpha",
  title: "Source Alpha",
  url: "https://example.com/reports/alpha?section=energy",
};

const evidenceSourceAlpha = { ...articleSource, fetchedEvidence: "Alpha evidence" };

const article: Article = {
  title: "A sourced example",
  body: [
    { type: "paragraph", text: "The first paragraph cites a source twice.", sourceIds: ["source-alpha", "source-alpha"], findingIds: [] },
    { type: "heading", text: "What the evidence says", sourceIds: ["source-beta"], findingIds: [] },
    { type: "list", text: "A long-form point\nA second point", sourceIds: ["source-alpha"], findingIds: [] },
    { type: "paragraph", text: "Text that looks like <script>alert(1)</script> stays text.", sourceIds: ["missing-source"], findingIds: [] },
  ],
  citedSources: [
    articleSource,
    { sourceId: "source-beta", title: "Source Beta", url: "https://news.example.org/articles/beta" },
  ],
};

const evidence: EvidenceBundle = {
  sources: [
    evidenceSourceAlpha,
    { sourceId: "source-beta", title: "Source Beta", url: "https://news.example.org/articles/beta", fetchedEvidence: "Beta evidence" },
    { sourceId: "source-gamma", title: "Rejected research", url: "https://research.example.net/gamma", fetchedEvidence: "Gamma evidence" },
  ],
  findings: [
    { findingId: "finding-supported", claim: "The supported claim", sourceId: "source-alpha", evidence: "Alpha evidence", verdict: "supported", rationale: "The source directly supports the claim.", corroboratingSourceIds: [] },
    { findingId: "finding-unsupported", claim: "The unsupported claim", sourceId: "source-gamma", evidence: "Limited evidence", verdict: "unsupported", rationale: "The available evidence is too thin.", corroboratingSourceIds: [] },
    { findingId: "finding-conflicting", claim: "The conflicting claim", sourceId: "source-beta", evidence: "Sources disagree", verdict: "conflicting", rationale: "The evidence points in different directions.", corroboratingSourceIds: [] },
  ],
};

function toReactElement(value: unknown): ReactNode {
  if (Array.isArray(value)) return value.map(toReactElement);
  if (typeof value !== "object" || value === null) return value as ReactNode;
  const node = value as { __pw_type?: string; type?: unknown; props?: Record<string, unknown>; key?: string | number | null };
  if (node.__pw_type !== "jsx" || (typeof node.type !== "function" && typeof node.type !== "string")) return value as ReactNode;
  const props = Object.fromEntries(Object.entries(node.props ?? {}).map(([key, child]) => [key, toReactElement(child)]));
  if (typeof node.type === "function") return toReactElement((node.type as (componentProps: Record<string, unknown>) => unknown)(props));
  return createElement(node.type as keyof React.JSX.IntrinsicElements, { ...props, key: node.key });
}

function fixtureMarkup() {
  return renderToStaticMarkup(
    toReactElement(
      { __pw_type: "jsx", type: "main", props: { children: [PostContent({ article }), SourceList({ sources: article.citedSources }), VerificationSummary({ evidence })] } },
    ),
  );
}

test.describe("post content and evidence presentation", () => {
  test("renders safe article blocks, repeated citations, and separated verdicts", async ({ page }) => {
    await page.setContent(fixtureMarkup());

    await expect(page.getByRole("heading", { name: "A sourced example", exact: true })).toBeVisible();
    await expect(page.getByText("Text that looks like <script>alert(1)</script> stays text.", { exact: true })).toBeVisible();
    await expect(page.locator("script")).toHaveCount(0);
    await expect(page.locator(".article-citation[data-source-id='source-alpha']")).toHaveCount(3);
    await expect(page.locator(".article-citation[data-source-id='source-alpha']").first()).toHaveAttribute("href", articleSource.url);
    await expect(page.locator(".source-list .source-item")).toHaveCount(2);
    await expect(page.locator(".source-list .source-domain", { hasText: "example.com" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Unsupported findings" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Conflicting findings" })).toBeVisible();
    await expect(page.getByText("These findings did not have enough support and are not article citations.", { exact: true })).toBeVisible();
    await expect(page.locator(".source-list").getByText("Rejected research", { exact: true })).toHaveCount(0);
    await expect(page.getByText("This assessment describes what was checked; it is not a guarantee of factual certainty.", { exact: true })).toBeVisible();
  });

  test("rejects unsafe URLs, ignores invalid references, and remains keyboard-usable on mobile", async ({ page }) => {
    const unsafeArticle = {
      ...article,
      citedSources: [
        { sourceId: "source-unsafe", title: "Unsafe source", url: "javascript:alert(1)" },
        { sourceId: "source-safe", title: "Safe source", url: "https://example.com/safe" },
      ],
      body: [{ type: "paragraph", text: "Unsafe URL and unknown citation.", sourceIds: ["source-unsafe", "missing-source"], findingIds: [] }],
    } as unknown as Article;
    const unsafeEvidence = {
      ...evidence,
      sources: [],
      findings: [{ ...evidence.findings[0], sourceId: "missing-source" }],
    } as unknown as EvidenceBundle;
    const markup = renderToStaticMarkup(
      toReactElement(
        { __pw_type: "jsx", type: "main", props: { children: [PostContent({ article: unsafeArticle }), SourceList({ sources: unsafeArticle.citedSources }), VerificationSummary({ evidence: unsafeEvidence })] } },
      ),
    );

    await page.setViewportSize({ width: 390, height: 844 });
    await page.setContent(markup);
    await expect(page.locator("a[href^='javascript:']")).toHaveCount(0);
    await expect(page.getByText("This source link is unavailable.", { exact: true })).toBeVisible();
    await expect(page.getByText("Source reference unavailable", { exact: true })).toBeVisible();
    await expect(page.getByText("[Source unavailable]", { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    const sourceLink = page.locator("a").first();
    await sourceLink.focus();
    await expect(sourceLink).toBeFocused();
  });
});
