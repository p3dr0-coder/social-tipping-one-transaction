"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CastCard } from "./CastCard";
import { useNear } from "~~/lib/near-provider";
import { fetchGlobalFeed, streamUpdates, type FeedItem } from "~~/lib/social";

type LoadMode = "initial" | "refresh" | "more";

export const Feed = () => {
  const { accountId } = useNear();
  const [items, setItems] = useState<FeedItem[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadedKey, setLoadedKey] = useState<string | undefined>(undefined);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const activeKey = accountId ?? "";
  const loading = loadedKey !== activeKey;

  const cursorRef = useRef<string | null>(null);
  const requestRef = useRef(0);

  const load = useCallback(
    async (mode: LoadMode) => {
      const requestId = requestRef.current + 1;
      requestRef.current = requestId;
      if (mode === "refresh") setRefreshing(true);
      if (mode === "more") setLoadingMore(true);

      try {
        const page = await fetchGlobalFeed(
          mode === "more" ? (cursorRef.current ?? undefined) : undefined,
          undefined,
          accountId ?? undefined,
        );
        if (requestRef.current !== requestId) return;

        cursorRef.current = page.next_cursor;
        setHasMore(page.next_cursor !== null);
        setItems(previous => {
          const merged = mode === "more" ? [...previous, ...page.items] : page.items;
          const seen = new Set<string>();
          return merged.filter(item => {
            if (seen.has(item.post.key)) return false;
            seen.add(item.post.key);
            return true;
          });
        });
        setError(null);
      } catch (cause) {
        if (requestRef.current === requestId) {
          setError(cause instanceof Error ? cause.message : "The feed could not be loaded");
        }
      } finally {
        if (requestRef.current === requestId) {
          setLoadedKey(activeKey);
          setRefreshing(false);
          setLoadingMore(false);
        }
      }
    },
    [accountId, activeKey],
  );

  useEffect(() => {
    let cancelled = false;
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    fetchGlobalFeed(undefined, undefined, accountId ?? undefined)
      .then(page => {
        if (cancelled || requestRef.current !== requestId) return;
        cursorRef.current = page.next_cursor;
        setHasMore(page.next_cursor !== null);
        setItems(page.items);
        setError(null);
      })
      .catch(cause => {
        if (!cancelled && requestRef.current === requestId) {
          setError(cause instanceof Error ? cause.message : "The feed could not be loaded");
        }
      })
      .finally(() => {
        if (!cancelled && requestRef.current === requestId) {
          setLoadedKey(activeKey);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [accountId, activeKey]);

  useEffect(() => {
    const handlePostIndexed = () => {
      void load("refresh");
    };
    window.addEventListener("post-indexed", handlePostIndexed);
    const stopStream = streamUpdates(block => {
      if (block.posts.length > 0) void load("refresh");
    });
    return () => {
      window.removeEventListener("post-indexed", handlePostIndexed);
      stopStream();
    };
  }, [load]);

  if (loading) {
    return (
      <div className="flex flex-col gap-4">
        {[1, 2, 3].map(index => (
          <div key={index} className="glass-panel h-48 rounded-[2rem] animate-pulse"></div>
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex justify-between items-center px-2">
        <h2 className="text-2xl font-black tracking-tight flex items-center gap-3">
          Global feed
          <span className="badge badge-primary badge-outline font-mono text-xs py-3">LIVE</span>
        </h2>
        <button
          className={`btn btn-ghost btn-sm rounded-full hover:bg-white/10 ${refreshing ? "loading" : ""}`}
          onClick={() => {
            void load("refresh");
          }}
          disabled={refreshing}
        >
          {!refreshing && "Refresh"}
        </button>
      </div>

      {error && (
        <div className="alert alert-error text-sm rounded-2xl">
          <span>{error}</span>
        </div>
      )}

      <div className="flex flex-col gap-4">
        {items.length === 0 ? (
          <div className="glass-panel p-16 text-center rounded-[2.5rem] border-dashed border-2 border-base-content/10">
            <div className="text-6xl mb-6 opacity-40">◌</div>
            <h3 className="text-2xl font-black mb-2">Nothing here yet</h3>
            <p className="opacity-50 max-w-xs mx-auto">
              Write the first post and it will appear as soon as the indexer accepts it.
            </p>
          </div>
        ) : (
          items.map(item => <CastCard key={item.post.key} post={item.post} repostedBy={item.reposted_by} />)
        )}
      </div>

      <div className="text-center py-8">
        <button
          className="btn btn-outline btn-wide rounded-full hover:bg-white/5 transition-all"
          onClick={() => {
            void load("more");
          }}
          disabled={loadingMore || !hasMore}
        >
          {loadingMore ? "Loading..." : hasMore ? "Load older posts" : "End of the feed"}
        </button>
        <div className="mt-4 opacity-30 text-[10px] font-mono tracking-widest uppercase">
          Reads come from the near.social indexer
        </div>
      </div>
    </div>
  );
};
