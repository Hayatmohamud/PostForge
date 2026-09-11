import { expect, test } from "@playwright/test";

const acceptedPostId = "507f1f77bcf86cd799439011";

test.describe("topic form", () => {
  test("requires a topic and preserves it after an oversized submission", async ({ page }) => {
    await page.goto("/");
    const topic = page.getByLabel("What should we explore?");

    await page.getByRole("button", { name: "Generate post" }).click();
    await expect(page.locator("#topic-error")).toHaveText("Enter a topic before generating a post.");

    const oversized = "x".repeat(501);
    await topic.fill(oversized);
    await page.getByRole("button", { name: "Generate post" }).click();
    await expect(page.locator("#topic-error")).toHaveText("Keep your topic to 500 characters or fewer.");
    await expect(topic).toHaveValue(oversized);
  });

  test("accepts a valid topic and navigates to the live run", async ({ page }) => {
    await page.route("**/api/generate", (route) => route.fulfill({
      status: 202,
      contentType: "application/json",
      body: JSON.stringify({ postId: acceptedPostId }),
    }));
    await page.goto("/");
    await page.getByLabel("What should we explore?").fill("How community solar is changing local energy access");
    await page.getByRole("button", { name: "Generate post" }).click();
    await expect(page).toHaveURL(/\/posts\/(?:[a-f0-9]{24}|[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i);
  });
});
