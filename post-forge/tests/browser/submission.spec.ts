import { expect, test } from "@playwright/test";

const postId = "507f1f77bcf86cd799439011";

function acceptedResponse() {
  return { status: 202, contentType: "application/json", body: JSON.stringify({ postId }) };
}

test.describe("generation submission", () => {
  test("keeps one submission identity and navigates to the accepted post", async ({ page }) => {
    const requests: Array<{ topic: string; submissionKey: string }> = [];
    await page.route("**/api/generate", async (route) => {
      requests.push(JSON.parse(route.request().postData() ?? "{}"));
      await route.fulfill(acceptedResponse());
    });

    await page.goto("/");
    await page.getByLabel("What should we explore?").fill("A resilient topic");
    await page.getByRole("button", { name: "Generate post" }).click();
    await expect.poll(() => requests.length).toBe(1);
    await expect(page).toHaveURL(new RegExp(`/posts/${postId}$`));
    expect(requests[0]).toMatchObject({ topic: "A resilient topic" });
    expect(requests[0].submissionKey).toMatch(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/);
  });

  test("retries a lost response with the same key", async ({ page }) => {
    const requests: Array<{ topic: string; submissionKey: string }> = [];
    let attempt = 0;
    await page.route("**/api/generate", async (route) => {
      requests.push(JSON.parse(route.request().postData() ?? "{}"));
      attempt += 1;
      if (attempt === 1) {
        await route.abort("failed");
        return;
      }
      await route.fulfill(acceptedResponse());
    });

    await page.goto("/");
    await page.getByLabel("What should we explore?").fill("Retry this topic");
    await page.getByRole("button", { name: "Generate post" }).click();
    await expect(page.locator("#topic-error")).toHaveText("We could not reach PostForge. Try again.");
    await page.getByRole("button", { name: "Generate post" }).click();
    await expect(page).toHaveURL(new RegExp(`/posts/${postId}$`));
    expect(requests).toHaveLength(2);
    expect(requests[1].submissionKey).toBe(requests[0].submissionKey);
  });

  test("restores a pending topic after reload and creates a new key when it changes", async ({ page }) => {
    const requests: Array<{ topic: string; submissionKey: string }> = [];
    let attempt = 0;
    await page.route("**/api/generate", async (route) => {
      requests.push(JSON.parse(route.request().postData() ?? "{}"));
      attempt += 1;
      if (attempt === 1) {
        await route.abort("failed");
        return;
      }
      await route.fulfill(acceptedResponse());
    });

    await page.goto("/");
    await page.getByLabel("What should we explore?").fill("Original topic");
    await page.getByRole("button", { name: "Generate post" }).click();
    await expect(page.locator("#topic-error")).toBeVisible();
    const firstKey = requests[0].submissionKey;

    await page.reload();
    await expect(page.getByLabel("What should we explore?")).toHaveValue("Original topic");
    await page.getByLabel("What should we explore?").fill("Changed topic");
    await page.getByRole("button", { name: "Generate post" }).click();
    await expect(page).toHaveURL(new RegExp(`/posts/${postId}$`));
    expect(requests).toHaveLength(2);
    expect(requests[1]).toMatchObject({ topic: "Changed topic" });
    expect(requests[1].submissionKey).not.toBe(firstKey);
  });

  test("keeps the topic and exposes an actionable validation error", async ({ page }) => {
    await page.route("**/api/generate", (route) => route.fulfill({
      status: 400,
      contentType: "application/json",
      body: JSON.stringify({ error: {
        code: "INVALID_INPUT", message: "The topic could not be accepted.", status: 400, retryable: false,
      } }),
    }));

    await page.goto("/");
    const topic = page.getByLabel("What should we explore?");
    await topic.fill("Keep this topic visible");
    await page.getByRole("button", { name: "Generate post" }).click();
    await expect(page.locator("#topic-error")).toHaveText("The topic could not be accepted.");
    await expect(topic).toHaveValue("Keep this topic visible");
  });

  test("ignores a double submit while the first request is pending", async ({ page }) => {
    let release: (() => void) | undefined;
    const requests: Array<{ topic: string; submissionKey: string }> = [];
    await page.route("**/api/generate", async (route) => {
      requests.push(JSON.parse(route.request().postData() ?? "{}"));
      await new Promise<void>((resolve) => { release = resolve; });
      await route.fulfill(acceptedResponse());
    });

    await page.goto("/");
    await page.getByLabel("What should we explore?").fill("Only once");
    const button = page.locator("button[type=submit]");
    await button.click();
    await expect(button).toBeDisabled();
    await button.click({ force: true });
    await expect.poll(() => requests.length).toBe(1);
    release?.();
    await expect(page).toHaveURL(new RegExp(`/posts/${postId}$`));
  });
});
