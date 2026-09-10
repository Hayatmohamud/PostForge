import { expect, test } from "@playwright/test";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { StageTimeline } from "../../src/components/stage-timeline";
import type { StageName, StageState } from "../../src/lib/contracts/post";

const stageLabels = ["Research", "Verify", "Write", "Edit", "Illustrate", "Publish"] as const;
const statusLabels = ["Queued", "Active", "Retrying", "Done", "Failed", "Queued"] as const;

const states: Readonly<Record<StageName, StageState>> = {
  research: { status: "queued", attempts: 0 },
  verify: { status: "active", attempts: 1, startedAt: "2026-09-10T08:00:00.000Z", activity: "Checking supported claims" },
  write: { status: "retrying", attempts: 2, startedAt: "2026-09-10T08:00:00.000Z", activity: "Correcting structured output" },
  edit: { status: "done", attempts: 1, startedAt: "2026-09-10T08:00:00.000Z", endedAt: "2026-09-10T08:01:30.000Z" },
  illustrate: { status: "failed", attempts: 1, startedAt: "2026-09-10T08:00:00.000Z", endedAt: "2026-09-10T08:02:00.000Z", activity: "Image provider unavailable" },
  publish: { status: "queued", attempts: 0 },
};

function toReactElement(value: unknown): ReactNode {
  if (Array.isArray(value)) return value.map(toReactElement);
  if (typeof value !== "object" || value === null) return value as ReactNode;
  const node = value as { __pw_type?: string; type?: unknown; props?: Record<string, unknown>; key?: string | number | null };
  if (node.__pw_type !== "jsx" || typeof node.type !== "function" && typeof node.type !== "string") return value as ReactNode;
  const props = Object.fromEntries(Object.entries(node.props ?? {}).map(([key, child]) => [key, toReactElement(child)]));
  return createElement(node.type as keyof React.JSX.IntrinsicElements, { ...props, key: node.key });
}

function fixtureMarkup() {
  const playwrightTree = StageTimeline({ stages: states, evidenceByStage: { verify: ["Claim checked against source one"] } });
  return renderToStaticMarkup(toReactElement(playwrightTree));
}

test.describe("pipeline states", () => {
  test("exposes all six statuses and expands details by keyboard", async ({ page }) => {
    await page.setContent(fixtureMarkup());
    await expect(page.getByRole("heading", { name: "Generation progress" })).toBeVisible();
    const list = page.getByRole("list", { name: "Post generation stages" });
    await expect(list.getByRole("listitem")).toHaveCount(6);
    for (let index = 0; index < stageLabels.length; index += 1) {
      const item = list.getByRole("listitem").nth(index);
      await expect(item.getByText(stageLabels[index], { exact: true })).toBeVisible();
      await expect(item.getByText(statusLabels[index], { exact: true })).toBeVisible();
    }
    const verifyDetails = page.locator("details").nth(1);
    const verify = verifyDetails.locator("summary");
    await verify.focus();
    await page.keyboard.press("Enter");
    await expect(verifyDetails).toHaveAttribute("open", "");
    await expect(page.getByText("Claim checked against source one")).toBeVisible();
  });

  test("remains readable at a narrow viewport", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.setContent(fixtureMarkup());
    await expect(page.getByRole("heading", { name: "Generation progress" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});
