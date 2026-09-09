import { beforeEach, describe, expect, test, vi } from "vitest";
import { Readable } from "node:stream";

const { getPosterStream } = vi.hoisted(() => ({ getPosterStream: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("../../src/lib/poster-storage", () => ({ getPosterStream }));

import { GET } from "../../src/app/api/posters/[id]/route";

const id = "507f1f77bcf86cd799439011";
const bytes = Buffer.from("poster-bytes");

function request() {
  return new Request(`http://localhost/api/posters/${id}`);
}

describe("GET /api/posters/[id]", () => {
  beforeEach(() => getPosterStream.mockReset());

  test("serves the complete poster with its declared media type and safe headers", async () => {
    getPosterStream.mockResolvedValue({
      id,
      postId: "507f1f77bcf86cd799439012",
      stage: "illustrate",
      mediaType: "image/png",
      byteSize: bytes.byteLength,
      completedAt: new Date().toISOString(),
      stream: Readable.from([bytes]),
    });

    const response = await GET(request(), { params: Promise.resolve({ id }) });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("content-length")).toBe(String(bytes.byteLength));
    expect(response.headers.get("content-disposition")).toBe(`inline; filename="${id}.png"`);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
  });

  test("rejects malformed IDs before reaching storage", async () => {
    const response = await GET(request(), { params: Promise.resolve({ id: "not-an-object-id" }) });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "INVALID_INPUT", status: 400 });
    expect(getPosterStream).not.toHaveBeenCalled();
  });

  test("returns 404 for an absent or incomplete poster", async () => {
    getPosterStream.mockResolvedValue(null);

    const response = await GET(request(), { params: Promise.resolve({ id }) });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Poster not found" });
  });

  test("propagates a download stream failure through the response body", async () => {
    const stream = Readable.from((async function* () {
      yield bytes.subarray(0, 4);
      throw new Error("private stream details");
    })());
    getPosterStream.mockResolvedValue({
      id,
      postId: "507f1f77bcf86cd799439012",
      stage: "illustrate",
      mediaType: "image/png",
      byteSize: bytes.byteLength,
      completedAt: new Date().toISOString(),
      stream,
    });

    const response = await GET(request(), { params: Promise.resolve({ id }) });

    expect(response.status).toBe(200);
    await expect(response.arrayBuffer()).rejects.toThrow();
  });

});
