"use client";

import { useEffect, useState } from "react";
import { useNear } from "~~/lib/near-provider";
import { isFollowing, isValidAccountId, setFollow } from "~~/lib/social";
import { notification } from "~~/utils/notification";

type ButtonSize = "xs" | "sm" | "lg";

const SIZE_CLASSES: Record<ButtonSize, string> = {
  xs: "px-3 py-1 text-[10px] h-6 min-w-[70px]",
  sm: "px-5 py-1.5 text-xs h-8 min-w-[95px]",
  lg: "px-8 py-3 text-sm h-12 min-w-[145px]",
};

export const FollowButton = ({ targetAccountId, size = "sm" }: { targetAccountId: string; size?: ButtonSize }) => {
  const { accountId, signAndSendTransaction } = useNear();
  const [following, setFollowing] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);

  const target = targetAccountId.toLowerCase().trim();

  useEffect(() => {
    let cancelled = false;
    if (!accountId || !isValidAccountId(target)) {
      setFollowing(false);
      return;
    }
    setFollowing(null);
    isFollowing(target, accountId)
      .then(value => {
        if (!cancelled) setFollowing(value);
      })
      .catch(() => {
        if (!cancelled) setFollowing(false);
      });
    return () => {
      cancelled = true;
    };
  }, [accountId, target]);

  if (accountId === target) return null;

  const toggleFollow = async () => {
    if (!accountId) {
      notification.error("Connect a wallet first");
      return;
    }
    if (!isValidAccountId(target)) {
      notification.error(`"${targetAccountId}" is not a valid account id`);
      return;
    }

    setLoading(true);
    try {
      const next = !(following ?? false);
      await setFollow(target, next, { accountId, signAndSendTransaction });
      setFollowing(next);
      notification.success(next ? `Following ${target}` : `Unfollowed ${target}`);
    } catch (error) {
      notification.error(error instanceof Error ? error.message : "The follow edge was not written");
    } finally {
      setLoading(false);
    }
  };

  if (following === null) {
    return (
      <div
        className={`animate-pulse bg-base-300/30 border border-base-content/10 rounded-full flex items-center justify-center ${SIZE_CLASSES[size]}`}
      >
        <span className="opacity-40 text-[10px] font-bold">Checking...</span>
      </div>
    );
  }

  return (
    <button
      onClick={toggleFollow}
      disabled={loading}
      id={`follow-btn-${target}`}
      className={`
        relative overflow-hidden transition-all duration-300 rounded-full font-bold tracking-wide flex items-center justify-center
        ${SIZE_CLASSES[size]}
        ${
          following
            ? "bg-base-200 border border-base-300 text-base-content/70 hover:bg-base-300 hover:text-base-content shadow-sm"
            : "bg-primary text-primary-content shadow-[0_4px_15px_rgba(var(--p),0.3)] hover:shadow-[0_8px_25px_rgba(var(--p),0.5)] hover:scale-105 active:scale-95 border border-transparent"
        }
        ${loading ? "opacity-50 cursor-wait" : "opacity-100 visible"}
      `}
    >
      <span className="relative z-10 flex items-center justify-center gap-2">
        {loading ? (
          <span className="loading loading-spinner loading-xs"></span>
        ) : following ? (
          <>
            <span>Following</span>
            <span className="text-[10px] opacity-70">✓</span>
          </>
        ) : (
          <>
            <span>Follow</span>
            <span className="text-lg leading-none mb-0.5">+</span>
          </>
        )}
      </span>
    </button>
  );
};
