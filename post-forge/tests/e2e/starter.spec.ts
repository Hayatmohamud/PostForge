import { expect, test } from "@playwright/test";

// Server -> HTML -> browser reload only. Full generation awaits TASK-044.
test("a direct request and browser reload serve the same starter", async ({ request, page }) => {
  const response = await request.get("/");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("text/html");
  expect(await response.text()).toContain("The application foundation is ready.");

  await page.goto("/");
  await page.reload();
  await expect(page.getByRole("main")).toContainText("PostForge");
});
