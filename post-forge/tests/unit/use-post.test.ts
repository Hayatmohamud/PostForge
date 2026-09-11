import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPostPoller, type PostPollingSnapshot } from "../../src/hooks/use-post";

const postId = "507f1f77bcf86cd799439011";
const basePost = {
  postId,
  topic: "How durable workflows recover",
  status: "researching" as const,
  stages: {
    research: { status: "active" as const, attempts: 1, startedAt: "2026-09-11T08:00:00.000Z" },
    verify: { status: "queued" as const, attempts: 0 },
    write: { status: "queued" as const, attempts: 0 },
    edit: { status: "queued" as const, attempts: 0 },
    illustrate: { status: "queued" as const, attempts: 0 },
    publish: { status: "queued" as const, attempts: 0 },
  },
  createdAt: "2026-09-11T08:00:00.000Z",
  updatedAt: "2026-09-11T08:00:00.000Z",
};

function response(post: unknown, status = 200): Response {
  return new Response(JSON.stringify({ post }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function snapshots() {
  const values: PostPollingSnapshot[] = [];
  return { values, onSnapshot: (value: PostPollingSnapshot) => values.push(value) };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => { resolve = promiseResolve; });
  return { promise, resolve };
}

describe("createPostPoller", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("polls with bounded backoff, never overlaps requests, and stops on done", async () => {
    const firstResponse = deferred<Response>();
    const secondResponse = deferred<Response>();
    let activeRequests = 0;
    let maxActiveRequests = 0;
    let requestNumber = 0;
    const fetcher = vi.fn(() => {
      requestNumber += 1;
      activeRequests += 1;
      maxActiveRequests = Math.max(maxActiveRequests, activeRequests);
      const currentResponse = requestNumber === 1 ? firstResponse : secondResponse;
      return currentResponse.promise.finally(() => { activeRequests -= 1; });
    });
    const { values, onSnapshot } = snapshots();
    const poller = createPostPoller(postId, onSnapshot, { initialDelayMs: 10, maxDelayMs: 20, fetcher });

    expect(fetcher).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(100);
    expect(fetcher).toHaveBeenCalledTimes(1);
    firstResponse.resolve(response({ ...basePost, updatedAt: "2026-09-11T08:00:01.000Z" }));
    await vi.advanceTimersByTimeAsync(0);
    expect(values.at(-1)?.post?.updatedAt).toBe("2026-09-11T08:00:01.000Z");
    await vi.advanceTimersByTimeAsync(10);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(maxActiveRequests).toBe(1);
    secondResponse.resolve(response({ ...basePost, status: "done", updatedAt: "2026-09-11T08:00:02.000Z", article: { title: "Done", body: [{ type: "paragraph", text: "A finished article.", findingIds: [], sourceIds: [] }], citedSources: [] }, evidence: { findings: [{ findingId: "finding_1", claim: "A claim", sourceId: "source_1", verdict: "supported", rationale: "A source supports it." }], sources: [{ sourceId: "source_1", url: "https://example.com/source", title: "Source" }] }, poster: { posterId: "507f1f77bcf86cd799439012", mediaType: "image/png", byteSize: 1, completedAt: "2026-09-11T08:00:02.000Z" } }));
    await vi.advanceTimersByTimeAsync(0);
    expect(values.at(-1)?.phase).toBe("done");
    await vi.advanceTimersByTimeAsync(100);
    expect(fetcher).toHaveBeenCalledTimes(2);
    poller.stop();
  });

  it("keeps an outage separate from persisted generation failure and recovers", async () => {
    const fetcher = vi.fn()
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockResolvedValueOnce(response({
        ...basePost,
        status: "failed",
        updatedAt: "2026-09-11T08:00:02.000Z",
        error: { code: "TERMINAL_FAILURE", message: "The writer failed.", status: 500, retryable: false, postId },
      }));
    const { values, onSnapshot } = snapshots();
    const poller = createPostPoller(postId, onSnapshot, { initialDelayMs: 10, fetcher });

    await vi.advanceTimersByTimeAsync(0);
    expect(values.at(-1)?.fetchError?.kind).toBe("fetch");
    expect(values.at(-1)?.generationError).toBeNull();
    await vi.advanceTimersByTimeAsync(10);
    expect(values.at(-1)?.phase).toBe("failed");
    expect(values.at(-1)?.fetchError).toBeNull();
    expect(values.at(-1)?.generationError?.message).toBe("The writer failed.");
    poller.stop();
  });

  it("ignores late responses after cleanup and ID changes", async () => {
    let resolveRequest!: (value: Response) => void;
    const fetcher = vi.fn(() => new Promise<Response>((resolve) => { resolveRequest = resolve; }));
    const first = snapshots();
    const poller = createPostPoller(postId, first.onSnapshot, { fetcher });
    poller.stop();
    resolveRequest(response({ ...basePost, updatedAt: "2026-09-11T08:00:05.000Z" }));
    await Promise.resolve();
    expect(first.values).toHaveLength(0);

    const replacement = snapshots();
    let resolveReplacement!: (value: Response) => void;
    const replacementFetcher = vi.fn(() => new Promise<Response>((resolve) => { resolveReplacement = resolve; }));
    const replacementPoller = createPostPoller("507f1f77bcf86cd799439012", replacement.onSnapshot, { fetcher: replacementFetcher });
    replacementPoller.stop();
    resolveReplacement(response({ ...basePost, postId: "507f1f77bcf86cd799439012" }));
    await Promise.resolve();
    expect(replacement.values).toHaveLength(0);
  });
});
