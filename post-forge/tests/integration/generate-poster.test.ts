import { beforeEach, describe, expect, test, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  generateImage: vi.fn(),
  savePoster: vi.fn(),
  getPoster: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("../../src/lib/image", () => ({ generateImage: fixture.generateImage }));
vi.mock("../../src/lib/poster-storage", () => ({ savePoster: fixture.savePoster, getPoster: fixture.getPoster }));

import { generatePoster } from "../../src/agents/tools/generate-poster";

const postId = "507f1f77bcf86cd799439011";
const runId = "507f1f77bcf86cd799439012";
const posterId = "507f1f77bcf86cd799439013";
const imageConfig = { provider: "gemini", model: "gemini-2.5-flash-image", apiKey: "fake-image-secret" };
const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2]);
const completed = {
  id: posterId,
  postId,
  stage: "illustrate" as const,
  mediaType: "image/png" as const,
  byteSize: bytes.byteLength,
  completedAt: "2026-09-09T10:00:00.000Z",
};

function input(overrides: Record<string, unknown> = {}) {
  return { postId, runId, prompt: "A clean editorial poster about the topic.", imageConfig, ...overrides };
}

beforeEach(() => {
  fixture.generateImage.mockReset().mockResolvedValue({ bytes, mimeType: "image/png" });
  fixture.savePoster.mockReset().mockResolvedValue(completed);
  fixture.getPoster.mockReset().mockResolvedValue(null);
});

describe("generate poster tool", () => {
  test("validates identity, uses the saved image configuration, and returns only completed storage metadata", async () => {
    const result = await generatePoster(input());
    expect(result).toEqual(completed);
    expect(fixture.generateImage).toHaveBeenCalledWith(input().prompt, imageConfig);
    expect(fixture.savePoster).toHaveBeenCalledWith({ postId, stage: "illustrate", mediaType: "image/png", bytes }, undefined);
    expect(result).not.toHaveProperty("bytes");
    expect(JSON.stringify(result)).not.toContain("fake-image-secret");
  });

  test.each([
    { postId: "bad-id" },
    { runId: "bad-run" },
    { prompt: "" },
    { prompt: "x".repeat(8_001) },
    { imageConfig: { ...imageConfig, apiKey: "" } },
    { privatePayload: "secret" },
  ])("rejects malformed request %# before provider or storage", async (override) => {
    await expect(generatePoster(input(override))).rejects.toMatchObject({ phase: "validation", code: "INVALID_INPUT" });
    expect(fixture.generateImage).not.toHaveBeenCalled();
    expect(fixture.savePoster).not.toHaveBeenCalled();
  });

  test("reuses an existing completed poster without another provider or upload call", async () => {
    fixture.getPoster.mockResolvedValue({ ...completed, bytes });
    const result = await generatePoster(input({ existingPosterId: posterId }));
    expect(result).toEqual(completed);
    expect(fixture.getPoster).toHaveBeenCalledWith(posterId, undefined);
    expect(fixture.generateImage).not.toHaveBeenCalled();
    expect(fixture.savePoster).not.toHaveBeenCalled();
  });

  test("rejects a completed poster belonging to another post", async () => {
    fixture.getPoster.mockResolvedValue({ ...completed, postId: "507f1f77bcf86cd799439099", bytes });
    await expect(generatePoster(input({ existingPosterId: posterId }))).rejects.toMatchObject({ phase: "storage", code: "INVALID_INPUT" });
    expect(fixture.generateImage).not.toHaveBeenCalled();
  });

  test("classifies provider failure and never attempts upload", async () => {
    fixture.generateImage.mockRejectedValue(new Error("fake-provider-secret"));
    await expect(generatePoster(input())).rejects.toMatchObject({ phase: "provider", code: "TERMINAL_FAILURE" });
    expect(fixture.savePoster).not.toHaveBeenCalled();
    await expect(generatePoster(input())).rejects.toMatchObject({ phase: "provider", code: "TERMINAL_FAILURE" });
  });

  test("classifies transient provider failure without exposing provider details", async () => {
    fixture.generateImage.mockRejectedValue(Object.assign(new Error("fake-provider-secret"), { code: "ETIMEDOUT" }));
    const error = await generatePoster(input()).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ phase: "provider", code: "TRANSIENT_FAILURE" });
    expect(String(error)).not.toContain("fake-provider-secret");
  });

  test("classifies upload failure and returns no reference", async () => {
    fixture.savePoster.mockRejectedValue(new Error("fake-storage-secret"));
    const error = await generatePoster(input()).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ phase: "storage", code: "TERMINAL_FAILURE" });
    expect(String(error)).not.toContain("fake-storage-secret");
  });

  test("does not return a reference for malformed provider output", async () => {
    fixture.generateImage.mockResolvedValue({ bytes: new Uint8Array(), mimeType: "image/png" });
    await expect(generatePoster(input())).rejects.toMatchObject({ phase: "provider", code: "TERMINAL_FAILURE" });
    expect(fixture.savePoster).not.toHaveBeenCalled();
  });
});

