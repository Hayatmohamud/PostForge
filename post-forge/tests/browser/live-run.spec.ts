import { expect, test } from "@playwright/test";

const postId = "507f1f77bcf86cd799439011";
const createdAt = "2026-09-11T08:00:00.000Z";

function stagesFor(status: "queued" | "researching" | "writing" | "done" | "failed") {
  const order = ["research", "verify", "write", "edit", "illustrate", "publish"] as const;
  const activeIndex = status === "researching" ? 0 : status === "writing" ? 2 : status === "failed" ? 1 : -1;

  return Object.fromEntries(order.map((stage, index) => {
    if (status === "done" || (activeIndex >= 0 && index < activeIndex)) {
      return [stage, { status: "done", attempts: 1, startedAt: createdAt, endedAt: "2026-09-11T08:00:30.000Z" }];
    }
    if (status === "failed" && index === activeIndex) {
      return [stage, { status: "failed", attempts: 1, startedAt: createdAt, endedAt: "2026-09-11T08:00:30.000Z", activity: "The verification provider stopped responding." }];
    }
    if (index === activeIndex) {
      return [stage, { status: "active", attempts: 1, startedAt: createdAt, activity: `Working on ${stage}` }];
    }
    return [stage, { status: "queued", attempts: 0 }];
  }));
}

function post(status: "queued" | "researching" | "writing" | "done" | "failed", overrides: Record<string, unknown> = {}) {
  return {
    postId,
    topic: "How durable workflows recover",
    status,
    stages: stagesFor(status),
    createdAt,
    updatedAt: "2026-09-11T08:00:30.000Z",
    ...overrides,
  };
}

test.describe("live generation run", () => {
  test("renders persisted progress from queued through completion", async ({ page }) => {
    let requests = 0;
    const statusesSeen: string[] = [];
    await page.route("**/api/posts**", async (route) => {
      requests += 1;
      const current = requests === 1 ? post("queued") : requests === 2 ? post("researching") : post("done", {
        article: { title: "Finished", body: [{ type: "paragraph", text: "A finished article.", findingIds: [], sourceIds: [] }], citedSources: [] },
        evidence: { findings: [{ findingId: "finding_1", claim: "A claim", sourceId: "source_1", verdict: "supported", rationale: "A source supports it." }], sources: [{ sourceId: "source_1", url: "https://example.com/source", title: "Source" }] },
        poster: { posterId: "507f1f77bcf86cd799439012", mediaType: "image/png", byteSize: 1, completedAt: "2026-09-11T08:00:30.000Z" },
      });
      statusesSeen.push(current.status);
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ post: current }) });
    });

    await page.goto(`/posts/${postId}`);
    await expect(page.getByRole("list", { name: "Post generation stages" }).getByRole("listitem")).toHaveCount(6);
    await expect.poll(() => statusesSeen).toContain("queued");
    await expect.poll(() => requests).toBeGreaterThanOrEqual(2);
    await expect.poll(() => statusesSeen).toContain("researching");
    await expect.poll(() => requests).toBeGreaterThanOrEqual(3);
    await expect(page.getByTestId("run-completion-slot")).toBeVisible();
  });

  test("reconstructs saved progress after a reload", async ({ page }) => {
    let responseStatus: "researching" | "writing" = "researching";
    await page.route("**/api/posts**", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ post: post(responseStatus) }) });
    });

    await page.goto(`/posts/${postId}`);
    await expect(page.getByText("Researching", { exact: true })).toBeVisible();
    responseStatus = "writing";
    await page.reload();
    await expect(page.getByText("Writing", { exact: true })).toBeVisible();
    await expect(page.getByText("Write", { exact: true })).toBeVisible();
  });

  test("keeps the last saved progress visible through a temporary outage", async ({ page }) => {
    let requests = 0;
    let releaseRetry: (() => void) | undefined;
    await page.route("**/api/posts**", async (route) => {
      requests += 1;
      if (requests <= 2) {
        await route.abort("failed");
        return;
      }
      await new Promise<void>((resolve) => { releaseRetry = resolve; });
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ post: post("researching") }) });
    });

    await page.goto(`/posts/${postId}`);
    await expect(page.getByTestId("run-fetch-error")).toBeVisible();
    await expect.poll(() => Boolean(releaseRetry)).toBe(true);
    releaseRetry?.();
    await expect(page.getByText("Researching", { exact: true })).toBeVisible();
  });

  test("separates a missing post from a generation failure", async ({ page }) => {
    await page.route("**/api/posts**", async (route) => {
      await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: { code: "INVALID_INPUT", message: "Post not found.", status: 404, retryable: false, postId } }) });
    });
    await page.goto(`/posts/${postId}`);
    await expect(page.getByTestId("run-not-found")).toBeVisible();
    await expect(page.getByTestId("run-not-found").getByRole("link", { name: "New post" })).toHaveAttribute("href", "/");

    await page.unroute("**/api/posts**");
    await page.route("**/api/posts**", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ post: post("failed", {
        error: { code: "TERMINAL_FAILURE", message: "The verification provider stopped responding.", status: 500, retryable: false, postId, stage: "verify" },
      }) }) });
    });
    await page.goto(`/posts/${postId}`);
    await expect(page.getByTestId("run-generation-failure")).toBeVisible();
    await expect(page.getByText("Start a new post to try again.", { exact: true })).toBeVisible();
  });
});
