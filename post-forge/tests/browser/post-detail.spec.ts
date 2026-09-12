import { expect, test, type Page } from "@playwright/test";
import type { PostDetailDto } from "../../src/lib/contracts/api";

const postId = "507f1f77bcf86cd799439011";
const posterId = "507f1f77bcf86cd799439012";
const createdAt = "2026-09-11T08:00:00.000Z";
const completedAt = "2026-09-11T08:01:00.000Z";
const postUrl = `/posts/${postId}`;
const source = { sourceId: "source_1", title: "Durable workflow guide", url: "https://example.com/workflows" };
const rejectedSource = { sourceId: "source_2", title: "Unconfirmed research", url: "https://example.org/research" };
const posterBytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1ZsAAAAASUVORK5CYII=", "base64");

function completedPost(): PostDetailDto {
  const stage = { status: "done" as const, attempts: 1, startedAt: createdAt, endedAt: completedAt };
  return {
    postId,
    topic: "How durable workflows recover",
    status: "done",
    stages: { research: stage, verify: stage, write: stage, edit: stage, illustrate: stage, publish: stage },
    createdAt,
    updatedAt: completedAt,
    article: {
      title: "Recovery built into every step",
      body: [
        { type: "paragraph", text: "Saved checkpoints let a workflow recover its progress.", findingIds: ["finding_1"], sourceIds: [source.sourceId] },
        { type: "heading", text: "What is preserved", findingIds: [], sourceIds: [] },
        { type: "list", text: "Completed steps\nPersisted outputs", findingIds: ["finding_1"], sourceIds: [source.sourceId] },
      ],
      citedSources: [source],
    },
    evidence: {
      sources: [source, rejectedSource],
      findings: [
        { findingId: "finding_1", claim: "Workflows retain completed checkpoints.", sourceId: source.sourceId, verdict: "supported", rationale: "The guide describes persisted checkpoints." },
        { findingId: "finding_2", claim: "Every external call happens exactly once.", sourceId: rejectedSource.sourceId, verdict: "unsupported", rationale: "The research does not establish this guarantee." },
        { findingId: "finding_3", claim: "All providers retry identically.", sourceId: rejectedSource.sourceId, verdict: "conflicting", rationale: "The documented retry behavior differs." },
      ],
    },
    poster: { posterId, mediaType: "image/png", byteSize: posterBytes.length, completedAt },
  };
}

async function servePost(page: Page, post = completedPost()) {
  await page.route(`**/api/posts/${postId}`, (route) => route.fulfill({ json: { post } }));
}

async function servePoster(page: Page) {
  await page.route(`**/api/posters/${posterId}`, (route) => route.fulfill({ contentType: "image/png", body: posterBytes }));
}

async function expectArticleAndEvidence(page: Page) {
  await expect(page.getByRole("heading", { name: "Recovery built into every step", level: 1 })).toBeVisible();
  await expect(page.locator(".article-body p").filter({ hasText: "Saved checkpoints let a workflow recover its progress." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Sources", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Verification summary" })).toBeVisible();
}

test.describe("completed post detail", () => {
  test("opens a completed URL with its poster, citations, verification and creation time, including refresh", async ({ page }) => {
    let requests = 0;
    await page.route(`**/api/posts/${postId}`, (route) => {
      requests += 1;
      return route.fulfill({ json: { post: completedPost() } });
    });
    await servePoster(page);
    await page.goto(postUrl);
    await expectArticleAndEvidence(page);
    const poster = page.getByRole("img", { name: "Generated poster accompanying “Recovery built into every step”" });
    await expect(poster).toHaveAttribute("src", new RegExp(`/api/posters/${posterId}$`));
    await expect(poster).toHaveClass("poster-loaded");
    await expect.poll(() => poster.evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    await expect(page.locator("time").first()).toHaveAttribute("datetime", createdAt);
    await expect(page.locator(".post-detail-meta")).toContainText("September 11, 2026");
    await expect(page.locator(".post-detail-meta")).toContainText("UTC");
    await expect(page.locator(".article-citation").first()).toHaveAttribute("href", source.url);
    await expect(page.locator(".source-list .source-item")).toHaveCount(1);
    await expect(page.locator(".source-list")).not.toContainText(rejectedSource.title);
    for (const verdict of ["Supported findings", "Unsupported findings", "Conflicting findings"]) {
      await expect(page.getByRole("heading", { name: verdict, exact: true })).toBeVisible();
    }
    await expect(page.getByText("The guide describes persisted checkpoints.", { exact: false })).toBeVisible();
    await expect(page.getByText("This assessment describes what was checked; it is not a guarantee of factual certainty.", { exact: true })).toBeVisible();
    await expect(page.locator(".finding-item").first()).toContainText("Source excerpts are unavailable.");
    await expect(page.getByRole("button", { name: /delete|regenerate|publish|download|copy/i })).toHaveCount(0);
    await page.reload();
    await expectArticleAndEvidence(page);
    expect(requests).toBeGreaterThanOrEqual(2);
  });

  test("transitions at the existing URL from saved progress to the final content and stops polling", async ({ page }) => {
    await page.clock.install();
    let requests = 0;
    let complete = false;
    await page.route(`**/api/posts/${postId}`, (route) => {
      requests += 1;
      const post = completedPost();
      if (!complete) {
        post.status = "publishing";
        post.stages.publish = { status: "active", attempts: 1, startedAt: createdAt };
        delete post.article;
        delete post.evidence;
        delete post.poster;
      }
      return route.fulfill({ json: { post } });
    });
    await servePoster(page);
    await page.goto(postUrl);
    await expect(page.getByTestId("run-status")).toHaveText("Publishing");
    await expect(page.getByRole("list", { name: "Post generation stages" })).toBeVisible();
    await expect(page.locator(".post-detail")).toHaveCount(0);
    complete = true;
    await page.clock.fastForward(1_000);
    await expectArticleAndEvidence(page);
    await expect(page).toHaveURL(postUrl);
    await expect(page.locator(".run-view")).toHaveCount(0);
    await expect(page.getByTestId("run-status")).toContainText("Your post is ready");
    await expect(page.getByRole("list", { name: "Post generation stages" })).toBeHidden();
    const terminalRequests = requests;
    await page.clock.fastForward(30_000);
    expect(requests).toBe(terminalRequests);
    await page.getByText("View completed generation stages", { exact: true }).click();
    await expect(page.getByRole("list", { name: "Post generation stages" }).getByRole("listitem")).toHaveCount(6);
  });

  test("keeps the article readable while the poster is loading", async ({ page }) => {
    await servePost(page);
    let releasePoster: (() => void) | undefined;
    const posterReady = new Promise<void>((resolve) => { releasePoster = resolve; });
    await page.route(`**/api/posters/${posterId}`, async (route) => {
      await posterReady;
      await route.fulfill({ contentType: "image/png", body: posterBytes });
    });
    try {
      await page.goto(postUrl, { waitUntil: "domcontentloaded" });
      await expect(page.getByText("Loading poster…", { exact: true })).toBeVisible();
      await expect(page.locator(".poster-frame")).toHaveAttribute("aria-busy", "true");
      await expectArticleAndEvidence(page);
      releasePoster?.();
      await expect(page.locator(".poster-loaded")).toBeVisible();
      await expect(page.getByText("Loading poster…", { exact: true })).toHaveCount(0);
      await expect(page.locator(".poster-frame")).toHaveAttribute("aria-busy", "false");
    } finally {
      releasePoster?.();
    }
  });

  for (const response of ["not-found", "invalid-image"] as const) {
    test(`preserves the article and evidence when the poster response is ${response}`, async ({ page }) => {
      await servePost(page);
      await page.route(`**/api/posters/${posterId}`, (route) => route.fulfill(response === "not-found"
        ? { status: 404, contentType: "application/json", body: '{"error":"Poster unavailable"}' }
        : { status: 200, contentType: "image/png", body: "not image bytes" }));
      await page.goto(postUrl);
      await expect(page.getByText("The poster could not be loaded. The article and its sources are still available below.", { exact: true })).toBeVisible();
      await expectArticleAndEvidence(page);
      await expect(page.getByTestId("run-generation-failure")).toHaveCount(0);
      await expect(page.locator(".poster-frame img")).toHaveCount(0);
    });
  }

  test("renders long titles, article blocks, sources and verification on mobile without horizontal overflow", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    const post = completedPost();
    const article = post.article!;
    article.title = "Recovery".repeat(60);
    article.body = Array.from({ length: 12 }, (_, index) => ({
      type: "paragraph" as const,
      text: `Paragraph ${index + 1}: ${"checkpoint".repeat(300)}`,
      findingIds: ["finding_1"],
      sourceIds: [source.sourceId],
    }));
    article.citedSources[0] = { ...source, url: `https://example.com/${"reference".repeat(140)}` };
    post.evidence!.findings[0].rationale = "Evidence".repeat(300);
    await servePost(page, post);
    await servePoster(page);
    await page.goto(postUrl);
    await expect(page.getByRole("heading", { name: article.title, level: 1 })).toBeVisible();
    await expect(page.locator(".article-body > p")).toHaveCount(12);
    await expect(page.getByRole("heading", { name: "Verification summary" })).toBeVisible();
    await expect(page.locator(".poster-loaded")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const citation = page.locator(".article-citation").first();
    await citation.focus();
    await expect(citation).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.locator(".article-citation").nth(1)).toBeFocused();
  });

  test("shows explicit missing deliverable notices if a saved done response is incomplete", async ({ page }) => {
    const post = completedPost();
    delete post.article;
    delete post.poster;
    delete post.evidence;
    await servePost(page, post);
    await page.goto(postUrl);
    await expect(page.getByRole("heading", { name: post.topic, level: 1 })).toBeVisible();
    await expect(page.getByText("The saved article is unavailable. Refresh this page to try loading it again.", { exact: true })).toBeVisible();
    await expect(page.getByText("No poster is available for this saved post.", { exact: true })).toBeVisible();
    await expect(page.getByText("No verification summary is available for this saved post.", { exact: true })).toBeVisible();
  });
});
