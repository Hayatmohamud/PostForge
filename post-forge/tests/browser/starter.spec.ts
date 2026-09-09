import { expect, test } from "@playwright/test";

test("starter renders without browser errors at desktop and mobile widths", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "PostForge", exact: true })).toBeVisible();
    await expect(page.getByText("The application foundation is ready.", { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expect(page.locator("[data-nextjs-dialog]")).toHaveCount(0);
  }
  expect(errors).toEqual([]);
});
