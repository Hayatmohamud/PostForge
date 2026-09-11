"use client";

import { useEffect, useState } from "react";
import {
  errorResponseSchema,
  postResponseSchema,
  type PostDetailDto,
} from "../lib/contracts/api";

type PublicError = NonNullable<PostDetailDto["error"]>;

export const POST_POLLING_DEFAULTS = Object.freeze({
  initialDelayMs: 1_000,
  maxDelayMs: 10_000,
  backoffFactor: 2,
});

export type PostPollingOptions = Readonly<{
  initialDelayMs?: number;
  maxDelayMs?: number;
  backoffFactor?: number;
  fetcher?: typeof fetch;
}>;

export type PostFetchError = Readonly<{
  kind: "fetch";
  message: string;
  status?: number;
  retryable: boolean;
}>;

export type PostPollingPhase = "idle" | "loading" | "ready" | "done" | "failed" | "fetch-error";

export type PostPollingSnapshot = Readonly<{
  post: PostDetailDto | null;
  phase: PostPollingPhase;
  loading: boolean;
  isLoading: boolean;
  isPolling: boolean;
  fetchError: PostFetchError | null;
  generationError: PublicError | null;
  /** Compatibility alias for consumers that use a single transport-error field. */
  error: PostFetchError | null;
}>;

export type PostPoller = Readonly<{ stop: () => void }>;

const initialSnapshot: PostPollingSnapshot = {
  post: null,
  phase: "idle",
  loading: false,
  isLoading: false,
  isPolling: false,
  fetchError: null,
  generationError: null,
  error: null,
};

function snapshotForPostId(postId: string | null | undefined): PostPollingSnapshot {
  if (!postId) return initialSnapshot;
  return { ...initialSnapshot, phase: "loading", loading: true, isLoading: true, isPolling: true };
}

function asPositiveFinite(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : fallback;
}

function normalizeOptions(options: PostPollingOptions): Required<Omit<PostPollingOptions, "fetcher">> & Pick<PostPollingOptions, "fetcher"> {
  const initialDelayMs = asPositiveFinite(options.initialDelayMs, POST_POLLING_DEFAULTS.initialDelayMs);
  const maxDelayMs = Math.max(initialDelayMs, asPositiveFinite(options.maxDelayMs, POST_POLLING_DEFAULTS.maxDelayMs));
  const backoffFactor = Math.max(1, asPositiveFinite(options.backoffFactor, POST_POLLING_DEFAULTS.backoffFactor));
  return { initialDelayMs, maxDelayMs, backoffFactor, fetcher: options.fetcher };
}

function retryDelay(failureCount: number, options: ReturnType<typeof normalizeOptions>): number {
  return Math.min(
    options.maxDelayMs,
    options.initialDelayMs * options.backoffFactor ** Math.max(0, failureCount - 1),
  );
}

function fetchError(message: string, retryable: boolean, status?: number): PostFetchError {
  return { kind: "fetch", message, retryable, ...(status === undefined ? {} : { status }) };
}

function isTerminal(post: PostDetailDto): boolean {
  return post.status === "done" || post.status === "failed";
}

function isOlderPost(candidate: PostDetailDto, current: PostDetailDto | null): boolean {
  if (!current || current.postId !== candidate.postId) return false;
  const candidateTime = Date.parse(candidate.updatedAt);
  const currentTime = Date.parse(current.updatedAt);
  return Number.isFinite(candidateTime) && Number.isFinite(currentTime) && candidateTime < currentTime;
}

function errorFromResponse(payload: unknown, status: number): PostFetchError {
  const parsed = errorResponseSchema.safeParse(payload);
  if (parsed.success) {
    return fetchError(parsed.data.error.message, parsed.data.error.retryable, status || parsed.data.error.status);
  }
  return fetchError("Unable to load the post.", status >= 500 || status === 408 || status === 429, status || undefined);
}

async function readPost(response: Response, postId: string): Promise<PostDetailDto> {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw fetchError("The post response was not valid JSON.", response.status >= 500, response.status || undefined);
  }

  if (!response.ok) throw errorFromResponse(payload, response.status);

  const parsed = postResponseSchema.safeParse(payload);
  if (!parsed.success || parsed.data.post.postId !== postId) {
    throw fetchError("The post response was invalid.", false, response.status || undefined);
  }
  return parsed.data.post;
}

function normalizeThrownError(error: unknown): PostFetchError {
  if (typeof error === "object" && error !== null && "kind" in error && error.kind === "fetch") {
    return error as PostFetchError;
  }
  return fetchError("Unable to load the post.", true);
}

/**
 * Start one sequential post reader. The hook below is intentionally a thin
 * React lifecycle adapter so the polling lifecycle can be tested with fake
 * timers without inventing a second API contract.
 */
export function createPostPoller(
  postId: string,
  onSnapshot: (snapshot: PostPollingSnapshot) => void,
  suppliedOptions: PostPollingOptions = {},
): PostPoller {
  const options = normalizeOptions(suppliedOptions);
  const fetcher = options.fetcher ?? globalThis.fetch;
  const controller = new AbortController();
  let active = true;
  let started = false;
  let inFlight = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let failureCount = 0;
  let snapshot: PostPollingSnapshot = snapshotForPostId(postId);

  const publish = (next: Partial<PostPollingSnapshot>) => {
    if (!active) return;
    snapshot = { ...snapshot, ...next };
    onSnapshot(snapshot);
  };

  const schedule = (delayMs: number) => {
    if (!active || timer !== undefined) return;
    publish({ isPolling: true });
    timer = setTimeout(() => {
      timer = undefined;
      void request();
    }, delayMs);
  };

  const request = async (): Promise<void> => {
    if (!active || inFlight) return;
    started = true;
    inFlight = true;

    try {
      const response = await fetcher(`/api/posts/${encodeURIComponent(postId)}`, {
        method: "GET",
        cache: "no-store",
        signal: controller.signal,
        headers: { Accept: "application/json" },
      });
      const post = await readPost(response, postId);
      if (!active) return;

      failureCount = 0;
      const stale = isOlderPost(post, snapshot.post);
      if (!stale) {
        publish({
          post,
          phase: post.status === "done" ? "done" : post.status === "failed" ? "failed" : "ready",
          loading: false,
          isLoading: false,
          fetchError: null,
          error: null,
          generationError: post.status === "failed" ? post.error ?? null : null,
        });
      } else {
        publish({ fetchError: null, error: null, loading: false, isLoading: false });
      }

      const currentPost = stale ? snapshot.post : post;
      if (!currentPost || !isTerminal(currentPost)) schedule(options.initialDelayMs);
      else publish({ isPolling: false });
    } catch (error) {
      if (!active) return;
      const failure = normalizeThrownError(error);
      failureCount += 1;
      publish({
        phase: "fetch-error",
        loading: false,
        isLoading: false,
        fetchError: failure,
        error: failure,
        isPolling: failure.retryable,
      });
      if (failure.retryable) schedule(retryDelay(failureCount, options));
    } finally {
      inFlight = false;
    }
  };

  void request();

  return {
    stop: () => {
      if (!active) return;
      active = false;
      if (!started) return;
      if (timer !== undefined) clearTimeout(timer);
      controller.abort();
    },
  };
}

export function usePost(
  postId: string | null | undefined,
  options: PostPollingOptions = {},
): PostPollingSnapshot {
  const [snapshot, setSnapshot] = useState<PostPollingSnapshot>(() => snapshotForPostId(postId));
  const initialDelayMs = options.initialDelayMs;
  const maxDelayMs = options.maxDelayMs;
  const backoffFactor = options.backoffFactor;
  const fetcher = options.fetcher;

  useEffect(() => {
    if (!postId) return undefined;
    return createPostPoller(postId, setSnapshot, { initialDelayMs, maxDelayMs, backoffFactor, fetcher }).stop;
  }, [postId, initialDelayMs, maxDelayMs, backoffFactor, fetcher]);

  return snapshot.post?.postId === postId || (snapshot.phase === "fetch-error" && snapshot.post === null) || (!postId && snapshot.phase === "idle")
    ? snapshot
    : snapshotForPostId(postId);
}
