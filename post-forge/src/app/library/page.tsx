"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { postsResponseSchema, type PostListItem } from "../../lib/contracts/api";
import { PostList } from "../../components/post-list";

const PAGE_SIZE = 20;
const MAX_LIBRARY_ITEMS = 200;
const MAX_LIBRARY_PAGES = MAX_LIBRARY_ITEMS / PAGE_SIZE;

type LoadMode = "initial" | "more";

async function fetchPosts(cursor?: string) {
  const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
  if (cursor) params.set("cursor", cursor);

  const response = await fetch(`/api/posts?${params.toString()}`, { cache: "no-store" });
  if (!response.ok) throw new Error("The library request failed.");

  const parsed = postsResponseSchema.safeParse(await response.json());
  if (!parsed.success) throw new Error("The library response was invalid.");
  return parsed.data;
}

export default function Library() {
  const [posts, setPosts] = useState<PostListItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string>();
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const requestId = useRef(0);
  const nextCursorRef = useRef<string | undefined>(undefined);
  const isLoadingRef = useRef(false);
  const isLoadingMoreRef = useRef(false);
  const hasLoadedRef = useRef(false);
  const mountedRef = useRef(false);
  const initialLoadStartedRef = useRef(false);

  const load = useCallback(async (mode: LoadMode, cursor?: string) => {
    if (mode === "initial") {
      if (isLoadingRef.current) return;
      isLoadingRef.current = true;
      setIsLoading(true);
    } else {
      if (isLoadingMoreRef.current || !cursor) return;
      isLoadingMoreRef.current = true;
      setIsLoadingMore(true);
    }

    const currentRequest = ++requestId.current;
    setError(null);

    try {
      const result = await fetchPosts(cursor);
      if (currentRequest !== requestId.current || !mountedRef.current) return;

      if (mode === "initial") {
        setPosts(result.posts);
        setPageCount(1);
      } else {
        setPosts((current) => {
          const existingIds = new Set(current.map((post) => post.postId));
          return [...current, ...result.posts.filter((post) => !existingIds.has(post.postId))];
        });
        setPageCount((current) => current + 1);
      }
      nextCursorRef.current = result.nextCursor;
      setNextCursor(result.nextCursor);
    } catch {
      if (currentRequest === requestId.current && mountedRef.current) {
        setError(mode === "more" ? "We could not load more posts." : "We could not load your past posts.");
      }
    } finally {
      if (mode === "initial") {
        isLoadingRef.current = false;
        hasLoadedRef.current = true;
        if (currentRequest === requestId.current && mountedRef.current) setIsLoading(false);
      } else {
        isLoadingMoreRef.current = false;
        if (currentRequest === requestId.current && mountedRef.current) setIsLoadingMore(false);
      }
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    if (!initialLoadStartedRef.current) {
      initialLoadStartedRef.current = true;
      void load("initial");
    }

    const refreshOnReturn = () => {
      if (hasLoadedRef.current && !isLoadingRef.current) void load("initial");
    };
    const refreshOnVisibility = () => {
      if (document.visibilityState === "visible") refreshOnReturn();
    };

    window.addEventListener("focus", refreshOnReturn);
    window.addEventListener("pageshow", refreshOnReturn);
    document.addEventListener("visibilitychange", refreshOnVisibility);
    return () => {
      window.removeEventListener("focus", refreshOnReturn);
      window.removeEventListener("pageshow", refreshOnReturn);
      document.removeEventListener("visibilitychange", refreshOnVisibility);
      mountedRef.current = false;
      isLoadingRef.current = false;
      isLoadingMoreRef.current = false;
    };
  }, [load]);

  const hasMore = Boolean(nextCursor && posts.length < MAX_LIBRARY_ITEMS && pageCount < MAX_LIBRARY_PAGES);
  const retry = () => {
    if (posts.length > 0 && nextCursorRef.current) {
      void load("more", nextCursorRef.current);
    } else {
      void load("initial");
    }
  };

  return (
    <main>
      <div className="library-heading">
        <div>
          <p className="eyebrow">Saved work</p>
          <h1>Library</h1>
        </div>
        <p className="library-intro">Reopen recent runs and completed posts.</p>
      </div>
      <PostList
        posts={posts}
        error={error}
        hasMore={hasMore}
        isLoading={isLoading}
        isLoadingMore={isLoadingMore}
        onLoadMore={() => {
          const cursor = nextCursorRef.current;
          if (cursor) void load("more", cursor);
        }}
        onRetry={retry}
      />
      <style jsx>{`
        .library-heading { display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(14rem, 0.9fr); align-items: end; gap: 2rem; margin-bottom: 2.25rem; }
        .library-intro { margin: 0 0 0.35rem; color: var(--color-text-muted); font-size: 1.05rem; }
        @media (max-width: 680px) {
          .library-heading { display: block; }
          .library-intro { margin-top: 1rem; }
        }
      `}</style>
    </main>
  );
}
