"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { Avatar } from "./Avatar";
import { FollowButton } from "./FollowButton";
import { useNear } from "~~/lib/near-provider";
import { fetchAccount, reputationFor, type Post } from "~~/lib/social";
import { sendTip } from "~~/lib/tips";
import { notification } from "~~/utils/notification";

type CastCardProps = {
  post: Post;
  repostedBy?: { account_id: string } | null;
};

export const CastCard = ({ post, repostedBy }: CastCardProps) => {
  const { accountId, signAndSendTransaction } = useNear();
  const [followers, setFollowers] = useState<number | null>(null);
  const [tipping, setTipping] = useState(false);

  const authorId = post.author.account_id;
  const isSelf = accountId === authorId;
  const reputation = followers === null ? null : reputationFor(followers);

  useEffect(() => {
    let cancelled = false;
    fetchAccount(authorId)
      .then(profile => {
        if (!cancelled) setFollowers(profile.followers);
      })
      .catch(() => {
        if (!cancelled) setFollowers(null);
      });
    return () => {
      cancelled = true;
    };
  }, [authorId]);

  const tipAuthor = async () => {
    if (!accountId) {
      notification.error("Connect a wallet first");
      return;
    }
    setTipping(true);
    try {
      const hash = await sendTip(authorId, null, { accountId, signAndSendTransaction });
      notification.success(`Tip settled: ${hash.slice(0, 10)}...`);
    } catch (error) {
      notification.error(error instanceof Error ? error.message : "The tip could not be sent");
    } finally {
      setTipping(false);
    }
  };

  return (
    <div className="glass-panel p-6 rounded-[1.5rem] transition-all duration-300 group relative overflow-hidden border border-base-content/5 hover:border-primary/30">
      {repostedBy && (
        <div className="text-[10px] uppercase tracking-widest opacity-40 mb-3">
          Reposted by {repostedBy.account_id}
        </div>
      )}
      <div className="flex gap-4 relative z-10">
        <div className="flex-shrink-0 pt-1">
          <Link href={`/${encodeURIComponent(authorId)}`}>
            <div className="avatar">
              <div className="w-12 h-12 rounded-full ring-2 ring-base-content/10 ring-offset-2 ring-offset-base-100 overflow-hidden hover:scale-110 transition-transform shadow-lg">
                <Avatar accountId={authorId} avatar={post.author.avatar_url} className="w-12 h-12" />
              </div>
            </div>
          </Link>
        </div>

        <div className="flex-grow min-w-0 pt-1">
          <div className="flex items-center justify-between gap-4 mb-3">
            <div className="flex flex-col sm:flex-row sm:items-baseline gap-2 min-w-0">
              <Link
                href={`/${encodeURIComponent(authorId)}`}
                className="font-black text-lg hover:text-primary transition-colors truncate tracking-tight"
              >
                {post.author.name ?? authorId}
              </Link>
              {reputation && (
                <span className="badge badge-outline badge-sm border-primary/30 text-primary/80">
                  {reputation.label}
                </span>
              )}
              <span className="opacity-30 text-[10px] font-mono whitespace-nowrap">
                {typeof post.created_at === "number" && post.created_at > 0
                  ? formatDistanceToNow(new Date(post.created_at), { addSuffix: true })
                  : `block ${post.block_height}`}
              </span>
            </div>

            <div className="flex items-center gap-2 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none group-hover:pointer-events-auto">
              <FollowButton targetAccountId={authorId} size="xs" />
              {!isSelf && (
                <button
                  onClick={tipAuthor}
                  disabled={tipping}
                  className="relative overflow-hidden rounded-full font-bold tracking-wide px-3 py-1 text-[10px] h-6 min-w-[65px] bg-secondary text-secondary-content shadow-lg hover:scale-105 active:scale-95 border border-base-content/10 flex items-center justify-center gap-1.5"
                  title={`Send a tip to ${authorId}`}
                >
                  {tipping ? <span className="loading loading-spinner loading-xs" /> : <span>Tip</span>}
                </button>
              )}
            </div>
          </div>

          <div className="pl-1">
            <p className="text-lg leading-relaxed opacity-90 break-words whitespace-pre-wrap font-sans text-base-content/90">
              {post.text}
            </p>
          </div>
        </div>
      </div>

      <div className="absolute inset-0 bg-primary/5 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none blur-3xl"></div>
    </div>
  );
};
