import { expect, test } from "@playwright/test";

const stages = [
  ["Research", "Queued", "○"],
  ["Verify", "Active", "◐"],
  ["Write", "Retrying", "↻"],
  ["Edit", "Done", "✓"],
  ["Illustrate", "Failed", "!"],
  ["Publish", "Queued", "○"],
] as const;

function fixtureMarkup() {
  return `
    <main>
      <section aria-labelledby="pipeline-heading">
        <p>Live pipeline</p><h1 id="pipeline-heading">Generation progress</h1>
        <ol aria-label="Post generation stages">
          ${stages.map(([name, status, icon]) => `
            <li class="stage-item stage-${status.toLowerCase()}">
              <button type="button" aria-expanded="false" aria-controls="panel-${name.toLowerCase()}">
                <span aria-hidden="true">${icon}</span><span>${name}</span><span>${status}</span><span aria-hidden="true">+</span>
              </button>
              <div id="panel-${name.toLowerCase()}" hidden><p>Activity for ${name}</p><h2>Evidence activity</h2><ul><li>Evidence item</li></ul></div>
            </li>`).join("")}
        </ol>
      </section>
    </main>`;
}

test.describe("pipeline states", () => {
  test("exposes all six statuses and expands details by keyboard", async ({ page }) => {
    await page.setContent(fixtureMarkup());
    await expect(page.getByRole("heading", { name: "Generation progress" })).toBeVisible();
    await expect(page.getByRole("list", { name: "Post generation stages" }).getByRole("listitem")).toHaveCount(6);
    for (const [name, status] of stages) {
      await expect(page.getByRole("button", { name: new RegExp(`${name}.*${status}`) })).toBeVisible();
    }
    const verify = page.getByRole("button", { name: /Verify.*Active/ });
    await verify.focus();
    await page.keyboard.press("Enter");
    await expect(verify).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator("#panel-verify")).toBeVisible();
  });

  test("remains readable at a narrow viewport", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.setContent(fixtureMarkup());
    await expect(page.getByRole("heading", { name: "Generation progress" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});
