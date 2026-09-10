import { describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@inngest/agent-kit", async () => {
  const actual = await vi.importActual<typeof import("@inngest/agent-kit")>("@inngest/agent-kit");
  return { ...actual, createTextModel: undefined };
});

import { research } from "../../src/agents/research";

const source = { title: "Source", url: "https://example.com/source", snippet: "A useful lead" };

describe("research agent", () => {
  test("exports a typed empty result for invalid topics", async () => {
    await expect(research("\u0000")).resolves.toEqual({ status: "invalid_output", sources: [], findings: [] });
  });

  test("does not fabricate findings from search snippets", async () => {
    const fetch = vi.fn();
    await expect(research("topic", {
      model: {} as never,
      search: vi.fn().mockResolvedValue([source]),
      fetch,
    })).rejects.toBeDefined();
    expect(fetch).not.toHaveBeenCalled();
  });
});
