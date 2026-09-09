import { HttpResponse, http } from "msw";
import { expect, test, vi } from "vitest";
import { fixtureServer } from "../helpers/setup";

// This verifies the HTTP fixture harness, not the unimplemented agent pipeline.
test("substitutes a provider response through the real fetch boundary", async () => {
  fixtureServer.use(http.post("https://provider.test/generate", async ({ request }) => {
    const body = await request.json() as { topic: string };
    return HttpResponse.json({ title: `Fixture: ${body.topic}`, source: "fixture" });
  }));

  const response = await fetch("https://provider.test/generate", {
    method: "POST",
    body: JSON.stringify({ topic: "Test topic" }),
    headers: { "Content-Type": "application/json" },
  });

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ title: "Fixture: Test topic", source: "fixture" });
});

test("resets prior handlers and refuses an unmocked provider request", async () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  await expect(fetch("https://provider.test/generate", { method: "POST" })).rejects.toThrow();
  expect(error).toHaveBeenCalled();
});
