"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { createPortal } from "react-dom";
import { XMarkIcon } from "@heroicons/react/24/outline";
import { Avatar } from "./Avatar";
import { fetchFollowers, fetchFollowing, type AccountCard } from "~~/lib/social";

type FollowModalProps = {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  accountId: string;
  kind: "followers" | "following";
};

const subscribeNoop = () => () => {};

export const FollowModal = ({ isOpen, onClose, title, accountId, kind }: FollowModalProps) => {
  const mounted = useSyncExternalStore(
    subscribeNoop,
    () => true,
    () => false,
  );
  const [state, setState] = useState<{
    key: string;
    items: AccountCard[];
    cursor: string | null;
    error: string | null;
  } | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const fetchKey = isOpen ? `${kind}:${accountId}` : null;
  const loading = Boolean(fetchKey) && state?.key !== fetchKey;
  const items = fetchKey && state?.key === fetchKey ? state.items : [];
  const cursor = fetchKey && state?.key === fetchKey ? state.cursor : null;
  const error = fetchKey && state?.key === fetchKey ? state.error : null;

  useEffect(() => {
    if (!isOpen) {
      document.body.style.overflow = "";
      return;
    }
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  useEffect(() => {
    if (!fetchKey) return;
    let cancelled = false;
    const load = kind === "followers" ? fetchFollowers : fetchFollowing;
    load(accountId)
      .then(page => {
        if (!cancelled) setState({ key: fetchKey, items: page.items, cursor: page.next_cursor, error: null });
      })
      .catch(cause => {
        if (!cancelled) {
          setState({
            key: fetchKey,
            items: [],
            cursor: null,
            error: cause instanceof Error ? cause.message : "The list could not be loaded",
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [fetchKey, accountId, kind]);

  const loadMore = async () => {
    if (!cursor || !fetchKey) return;
    setLoadingMore(true);
    try {
      const load = kind === "followers" ? fetchFollowers : fetchFollowing;
      const page = await load(accountId, cursor);
      setState(previous =>
        previous && previous.key === fetchKey
          ? { ...previous, items: [...previous.items, ...page.items], cursor: page.next_cursor }
          : previous,
      );
    } catch (cause) {
      setState(previous =>
        previous && previous.key === fetchKey
          ? { ...previous, error: cause instanceof Error ? cause.message : "The next page could not be loaded" }
          : previous,
      );
    } finally {
      setLoadingMore(false);
    }
  };

  if (!isOpen || !mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-base-100/80 backdrop-blur-xl transition-all animate-fade-in"
      onClick={onClose}
    >
      <div
        className="glass-panel w-full max-w-md rounded-[2rem] border border-white/10 shadow-2xl relative overflow-hidden animate-zoom-in bg-base-100"
        onClick={event => event.stopPropagation()}
      >
        <div className="flex items-center justify-between p-6 border-b border-white/5 bg-white/5">
          <h3 className="text-xl font-black tracking-tight flex items-center gap-2">
            <span>👥</span> {title}
            <span className="badge badge-primary badge-outline text-xs font-mono opacity-70 ml-2">{items.length}</span>
          </h3>
          <button
            onClick={onClose}
            className="btn btn-ghost btn-sm btn-circle hover:bg-white/10 opacity-50 hover:opacity-100 transition-all"
            aria-label="Close"
          >
            <XMarkIcon className="w-6 h-6" />
          </button>
        </div>

        <div className="max-h-[60vh] overflow-y-auto p-4 custom-scrollbar">
          {loading ? (
            <div className="flex flex-col items-center justify-center p-10">
              <span className="loading loading-spinner loading-lg text-primary"></span>
            </div>
          ) : error ? (
            <div className="alert alert-error text-sm m-2">{error}</div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center justify-center p-10 text-center opacity-40">
              <span className="text-4xl mb-2">🔭</span>
              <p className="font-bold italic">No accounts here yet.</p>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {items.map(card => (
                <Link
                  key={card.account_id}
                  href={`/${encodeURIComponent(card.account_id)}`}
                  className="flex items-center gap-4 p-3 rounded-2xl hover:bg-white/5 border border-transparent hover:border-white/5 transition-all group"
                  onClick={onClose}
                >
                  <div className="avatar">
                    <div className="w-10 h-10 rounded-full ring-2 ring-white/5 group-hover:ring-primary/40 transition-all overflow-hidden">
                      <Avatar accountId={card.account_id} avatar={card.avatar_url} className="w-10 h-10" />
                    </div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="font-bold text-sm truncate group-hover:text-primary transition-colors">
                      {card.name ?? card.account_id}
                    </h4>
                    <p className="text-[10px] opacity-40 font-mono truncate">{card.account_id}</p>
                  </div>
                  <div className="opacity-0 group-hover:opacity-100 transition-opacity transform translate-x-2 group-hover:translate-x-0 text-primary">
                    →
                  </div>
                </Link>
              ))}

              {cursor && (
                <button
                  className="btn btn-outline btn-sm rounded-full mt-2"
                  onClick={() => {
                    void loadMore();
                  }}
                  disabled={loadingMore}
                >
                  {loadingMore ? "Loading..." : "Load more"}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
};
