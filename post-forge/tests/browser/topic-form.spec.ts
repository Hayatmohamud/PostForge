import { expect, test } from "@playwright/test";

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

  test("accepts a valid topic and reports the captured state", async ({ page }) => {
    await page.goto("/");
    await page.getByLabel("What should we explore?").fill("How community solar is changing local energy access");
    await page.getByRole("button", { name: "Generate post" }).click();
    await expect(page.getByRole("status")).toContainText("Topic captured. Your run is ready to start.");
  });
});
