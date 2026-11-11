"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Avatar } from "./Avatar";
import { FollowButton } from "./FollowButton";
import { useNear } from "~~/lib/near-provider";
import { fetchSuggestions, type AccountCard } from "~~/lib/social";

export const SuggestedUsers = () => {
  const { accountId } = useNear();
  const [users, setUsers] = useState<AccountCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!accountId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetchSuggestions(accountId)
      .then(items => {
        if (!cancelled) {
          setUsers(items.slice(0, 8));
          setError(null);
        }
      })
      .catch(cause => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Suggestions are unavailable");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [accountId]);

  if (loading) {
    return (
      <div className="glass-panel p-6 rounded-[2rem] border border-white/5 flex flex-col gap-4 animate-pulse">
        <div className="h-4 w-32 bg-base-300 rounded mb-2"></div>
        {[1, 2, 3].map(index => (
          <div key={index} className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-base-300"></div>
            <div className="flex-1 space-y-2">
              <div className="h-3 bg-base-300 rounded w-3/4"></div>
              <div className="h-2 bg-base-300 rounded w-1/2"></div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="glass-panel p-6 rounded-[2rem] border border-white/5 text-center opacity-60">
        <p className="text-xs italic">{error}</p>
      </div>
    );
  }

  if (users.length === 0) {
    return (
      <div className="glass-panel p-6 rounded-[2rem] border border-white/5 text-center opacity-40">
        <p className="text-sm italic">No suggestions yet. Follow a few accounts to seed the graph.</p>
      </div>
    );
  }

  return (
    <div className="glass-panel p-4 rounded-[2rem] border border-base-content/5 flex flex-col gap-6 relative overflow-hidden group">
      <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-transparent opacity-50"></div>

      <h3 className="text-[10px] font-black uppercase tracking-widest opacity-40 px-2 flex items-center gap-3 relative z-10 mt-2">
        <span className="w-2 h-2 rounded-full bg-success animate-pulse"></span>
        Suggested accounts
      </h3>

      <div className="flex flex-col gap-4 relative z-10">
        {users.map(user => (
          <div
            key={user.account_id}
            className="group/user relative flex items-center p-2 rounded-2xl hover:bg-base-content/5 transition-all border border-transparent hover:border-base-content/10"
          >
            <Link href={`/${encodeURIComponent(user.account_id)}`} className="flex items-center gap-3 min-w-0 pr-2">
              <div className="w-10 h-10 rounded-full overflow-hidden border border-base-content/10 shrink-0 shadow-md transition-transform group-hover/user:scale-105">
                <Avatar accountId={user.account_id} avatar={user.avatar_url} className="w-10 h-10" />
              </div>
              <div className="flex flex-col min-w-0 flex-1 overflow-hidden">
                <span className="text-xs font-black truncate group-hover/user:text-primary transition-colors">
                  {user.name ?? user.account_id}
                </span>
                <span className="text-[8px] opacity-40 uppercase tracking-tighter font-mono truncate">
                  {typeof user.followers === "number" ? `${user.followers} followers` : "on the social graph"}
                </span>
              </div>
            </Link>

            <div className="ml-auto shrink-0 opacity-0 group-hover:opacity-100 transition-all transform translate-x-1 group-hover:translate-x-0">
              <FollowButton targetAccountId={user.account_id} size="xs" />
            </div>
          </div>
        ))}
      </div>

      <div className="mt-2 pt-4 border-t border-base-content/5 text-center">
        <p className="text-[9px] opacity-30 uppercase tracking-[0.2em] font-medium">Excludes accounts you follow</p>
      </div>
    </div>
  );
};
