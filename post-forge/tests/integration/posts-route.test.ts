import { beforeEach, describe, expect, test, vi } from "vitest";
import { postsResponseSchema } from "../../src/lib/contracts/api";
import { AppError } from "../../src/lib/errors";

const fixture = vi.hoisted(() => ({ listPosts: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("../../src/lib/posts", () => ({ listPosts: fixture.listPosts }));

import { GET, dynamic, runtime } from "../../src/app/api/posts/route";

const timestamp = "2026-09-09T10:00:00.000Z";
const first = {
  postId: "507f1f77bcf86cd799439011",
  topic: "First topic",
  status: "done" as const,
  posterId: "507f1f77bcf86cd799439022",
  createdAt: timestamp,
  updatedAt: timestamp,
};

function request(query = "") {
  return new Request(`http://localhost/api/posts${query}`);
}

function expectNoCache(response: Response) {
  expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  expect(response.headers.get("content-type")).toContain("application/json");
}

beforeEach(() => vi.clearAllMocks());

describe("GET /api/posts", () => {
  test("returns validated latest-first summaries and forwards pagination", async () => {
    const result = { posts: [first], nextCursor: "eyJjcmVhdGVkQXQiOiIyMDI2LTA5LTA5VDEwOjAwOjAwLjAwMFoiLCJpZCI6IjUwNz" };
    fixture.listPosts.mockResolvedValue(result);
    const response = await GET(request("?limit=10&cursor=next-page"));
    expect(response.status).toBe(200);
    expectNoCache(response);
    expect(postsResponseSchema.parse(await response.json())).toEqual(result);
    expect(fixture.listPosts).toHaveBeenCalledWith({ limit: 10, cursor: "next-page" });
  });

  test("uses repository defaults when pagination is omitted", async () => {
    fixture.listPosts.mockResolvedValue({ posts: [] });
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(fixture.listPosts).toHaveBeenCalledWith({});
    expect(await response.json()).toEqual({ posts: [] });
  });

  test.each(["?limit=", "?limit=1.5", "?limit=-1", "?limit=1&limit=2", "?cursor=a&cursor=b"])("rejects malformed pagination %s before repository work", async (query) => {
    const response = await GET(request(query));
    expect(response.status).toBe(400);
    expectNoCache(response);
    expect(await response.json()).toMatchObject({ error: { code: "INVALID_INPUT", status: 400, retryable: false } });
    expect(fixture.listPosts).not.toHaveBeenCalled();
  });

  test.each([
    [new AppError("TRANSIENT_FAILURE"), 503, "TRANSIENT_FAILURE"],
    [new AppError("CONFIGURATION_ERROR"), 500, "CONFIGURATION_ERROR"],
    [new Error("private database details"), 500, "TERMINAL_FAILURE"],
  ] as const)("maps repository failure safely", async (error, status, code) => {
    fixture.listPosts.mockRejectedValue(error);
    const response = await GET(request());
    expect(response.status).toBe(status);
    expectNoCache(response);
    const body = await response.json();
    expect(body.error).toMatchObject({ code, status });
    expect(JSON.stringify(body)).not.toContain("private database details");
  });

  test("rejects an invalid repository result rather than leaking it", async () => {
    fixture.listPosts.mockResolvedValue({ posts: [{ ...first, topic: "" }] });
    const response = await GET(request());
    expect(response.status).toBe(500);
    expectNoCache(response);
    expect((await response.json()).error).toMatchObject({ code: "TERMINAL_FAILURE", status: 500 });
  });

  test("declares uncached node execution", () => {
    expect(runtime).toBe("nodejs");
    expect(dynamic).toBe("force-dynamic");
  });
});
