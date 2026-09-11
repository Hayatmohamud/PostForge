import { expect, test } from "@playwright/test";

const firstPost = {
  postId: "507f1f77bcf86cd799439011",
  topic: "Community solar is changing local energy access",
  status: "done",
  posterId: "507f1f77bcf86cd799439012",
  createdAt: "2026-09-09T10:00:00.000Z",
  updatedAt: "2026-09-09T10:02:00.000Z",
};

const secondPost = {
  postId: "507f1f77bcf86cd799439013",
  topic: "A very long topic that should wrap inside the responsive library card without creating horizontal overflow on a narrow screen",
  status: "researching",
  createdAt: "2026-09-08T10:00:00.000Z",
  updatedAt: "2026-09-08T10:01:00.000Z",
};

test.describe("past-post library", () => {
  test("renders mixed posts, links, status/date metadata, and remains responsive", async ({ page }) => {
    await page.route("**/api/posts**", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ posts: [firstPost, secondPost] }),
    }));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/library");

    await expect(page.getByRole("heading", { name: "Library" })).toBeVisible();
    await expect(page.getByRole("heading", { name: firstPost.topic })).toBeVisible();
    await expect(page.getByText("Completed", { exact: true })).toBeVisible();
    await expect(page.getByText("Researching", { exact: true })).toBeVisible();
    await expect(page.getByText("Created Sep 9, 2026", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: `Open post: ${firstPost.topic}` })).toHaveAttribute("href", `/posts/${firstPost.postId}`);
    await expect(page.getByRole("link", { name: `Open post: ${secondPost.topic}` })).toHaveAttribute("href", `/posts/${secondPost.postId}`);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  test("shows empty state and loads a bounded next page", async ({ page }) => {
    const requests: string[] = [];
    await page.route("**/api/posts**", async (route) => {
      const url = new URL(route.request().url());
      requests.push(url.search);
      const response = requests.length === 1
        ? { posts: [] }
        : url.searchParams.has("cursor")
          ? { posts: [{ ...secondPost, topic: "Second page post" }] }
          : { posts: [firstPost], nextCursor: "page-two" };
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(response) });
    });
    await page.goto("/library");
    await expect(page.getByTestId("library-empty")).toBeVisible();

    await page.reload();
    await page.goto("/library");
    await expect(page.getByRole("button", { name: "Load more posts" })).toBeVisible();
    await page.getByRole("button", { name: "Load more posts" }).click();
    await expect(page.getByRole("heading", { name: "Second page post" })).toBeVisible();
    expect(requests.some((search) => search.includes("limit=20"))).toBe(true);
  });

  test("recovers from an API error and hides a failed thumbnail", async ({ page }) => {
    let attempts = 0;
    await page.route("**/api/posts**", async (route) => {
      attempts += 1;
      if (attempts === 1) {
        await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "unavailable" }) });
        return;
      }
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ posts: [firstPost] }) });
    });
    await page.route("**/api/posters/**", (route) => route.fulfill({ status: 404, body: "missing" }));
    await page.goto("/library");
    await expect(page.getByTestId("library-error")).toBeVisible();
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByRole("heading", { name: firstPost.topic })).toBeVisible();
    await expect(page.getByText("No thumbnail", { exact: true })).toBeVisible();
  });

  test("refreshes the list after returning from another page", async ({ page }) => {
    let requests = 0;
    await page.route("**/api/posts**", async (route) => {
      requests += 1;
      const topic = requests === 1 ? "Before returning" : "After submitting a post";
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ posts: [{ ...firstPost, topic }] }),
      });
    });
    await page.goto("/library");
    await expect(page.getByRole("heading", { name: "Before returning" })).toBeVisible();
    await page.goto("/");
    await page.goBack();
    await expect(page.getByRole("heading", { name: "After submitting a post" })).toBeVisible();
  });
});
