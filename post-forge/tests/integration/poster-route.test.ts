import { beforeEach, describe, expect, test, vi } from "vitest";

const { getPoster } = vi.hoisted(() => ({ getPoster: vi.fn() }));

vi.mock("server-only", () => ({}), { virtual: true });
vi.mock("../../src/lib/poster-storage", () => ({ getPoster }));

import { GET } from "../../src/app/api/posters/[id]/route";

const id = "507f1f77bcf86cd799439011";
const bytes = Buffer.from("poster-bytes");

function request() {
  return new Request(`http://localhost/api/posters/${id}`);
}

describe("GET /api/posters/[id]", () => {
  beforeEach(() => getPoster.mockReset());

  test("serves the complete poster with its declared media type and safe headers", async () => {
    getPoster.mockResolvedValue({
      id,
      postId: "507f1f77bcf86cd799439012",
      stage: "illustrate",
      mediaType: "image/png",
      byteSize: bytes.byteLength,
      completedAt: new Date().toISOString(),
      bytes,
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
    expect(getPoster).not.toHaveBeenCalled();
  });

  test("returns 404 for an absent or incomplete poster", async () => {
    getPoster.mockResolvedValue(null);

    const response = await GET(request(), { params: Promise.resolve({ id }) });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Poster not found" });
  });

});
