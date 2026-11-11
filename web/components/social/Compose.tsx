"use client";

import { useState } from "react";
import { useNear } from "~~/lib/near-provider";
import { createPost } from "~~/lib/social";
import { notification } from "~~/utils/notification";

export const Compose = () => {
  const { accountId, signAndSendTransaction } = useNear();
  const [text, setDraft] = useState("");
  const [loading, setLoading] = useState(false);

  const handlePost = async () => {
    if (!accountId) {
      notification.error("Connect a wallet with a named account first");
      return;
    }

    setLoading(true);
    try {
      await createPost(text, { accountId, signAndSendTransaction });
      setDraft("");
      notification.success("Post written to the social DB");
      // Fired after the indexer confirmed every key, so readers can refresh immediately.
      window.dispatchEvent(new CustomEvent("post-indexed"));
    } catch (error) {
      notification.error(error instanceof Error ? error.message : "The post could not be written");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="glass-panel p-6 rounded-[2rem] border border-white/5 transition-all duration-300 focus-within:border-primary/50 relative overflow-hidden">
      <textarea
        className="textarea textarea-ghost w-full h-32 mb-2 text-xl font-medium resize-none focus:outline-none focus:bg-transparent bg-transparent p-2 text-base-content leading-relaxed"
        aria-label="Write a post"
        value={text}
        onChange={event => setDraft(event.target.value)}
        maxLength={280}
      />

      <div className="flex justify-between items-center pt-4 border-t border-white/5">
        <div className="flex items-center gap-3">
          {accountId && (
            <div className="badge badge-neutral gap-2 py-3 px-4 rounded-full border border-white/10">
              <span className="w-2 h-2 rounded-full bg-success animate-pulse" />
              <span className="font-bold opacity-80">{accountId}</span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-4">
          <span
            className={`text-xs font-mono tracking-widest ${text.length > 250 ? "text-error" : "opacity-30"}`}
          >{`${text.length}/280`}</span>

          <button
            className="btn btn-primary btn-md rounded-full px-8 hover:scale-105 transition-all font-bold text-white border-none relative overflow-hidden"
            onClick={handlePost}
            disabled={loading || text.trim().length === 0 || !accountId}
          >
            {loading && <span className="loading loading-spinner loading-xs text-black"></span>}
            <span className="relative z-10">{loading ? "Writing..." : "Post"}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
