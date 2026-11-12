"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { AccountGuard } from "~~/components/social/AccountGuard";
import { Avatar } from "~~/components/social/Avatar";
import { CastCard } from "~~/components/social/CastCard";
import { FollowButton } from "~~/components/social/FollowButton";
import { FollowListModal } from "~~/components/social/FollowListModal";
import { Sidebar } from "~~/components/social/Sidebar";
import { useNear } from "~~/lib/near-provider";
import {
  fetchAccount,
  fetchAccountPosts,
  isValidAccountId,
  reputationFor,
  type AccountProfile,
  type FeedItem,
} from "~~/lib/social";
import { getTipPreference } from "~~/lib/tips";
import { useTipAuthor } from "~~/lib/use-tip-author";
import { notification } from "~~/utils/notification";

export default function AccountPage() {
  const params = useParams<{ name: string | string[] }>();
  const router = useRouter();
  const { accountId: viewerId, signAndSendTransaction } = useNear();

  const rawName = Array.isArray(params?.name) ? params.name[0] : params?.name;
  const accountId = rawName ? decodeURIComponent(rawName).toLowerCase() : "";

  const [profile, setProfile] = useState<AccountProfile | null>(null);
  const [posts, setPosts] = useState<FeedItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modalType, setModalType] = useState<"followers" | "following" | null>(null);
  const [tipPreference, setTipPreference] = useState<string | null>(null);
  const { tipAuthor, tipping } = useTipAuthor({
    authorId: accountId,
    viewerId,
    signAndSendTransaction,
  });

  useEffect(() => {
    if (!isValidAccountId(accountId)) {
      setLoading(false);
      setError("That is not a valid NEAR account id.");
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    setPosts([]);
    setCursor(null);

    Promise.all([
      fetchAccount(accountId, viewerId),
      fetchAccountPosts(accountId, undefined, undefined, viewerId ?? undefined),
      getTipPreference(accountId),
    ])
      .then(([nextProfile, page, preference]) => {
        if (cancelled) return;
        setProfile(nextProfile);
        setPosts(page.items);
        setCursor(page.next_cursor);
        setTipPreference(preference);
      })
      .catch(cause => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "The account could not be loaded");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [accountId, viewerId]);

  const loadMore = useCallback(async () => {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const page = await fetchAccountPosts(accountId, cursor, undefined, viewerId ?? undefined);
      setPosts(previous => {
        const seen = new Set(previous.map(item => item.post.key));
        return [...previous, ...page.items.filter(item => !seen.has(item.post.key))];
      });
      setCursor(page.next_cursor);
    } catch (cause) {
      notification.error(cause instanceof Error ? cause.message : "Older posts could not be loaded");
    } finally {
      setLoadingMore(false);
    }
  }, [accountId, cursor, viewerId]);

  const copyAccountId = async () => {
    await navigator.clipboard.writeText(accountId);
    notification.success("Account id copied");
  };

  const reputation = profile ? reputationFor(profile.followers) : null;
  const isSelf = viewerId === accountId;

  return (
    <AccountGuard>
      <div className="max-w-7xl mx-auto px-4 py-12">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-10">
          <div className="hidden md:block md:col-span-4 lg:col-span-3">
            <Sidebar />
          </div>

          <div className="col-span-1 md:col-span-8 lg:col-span-9">
            <div className="flex flex-col gap-10">
              <div className="glass-panel rounded-[3rem] p-1 border border-white/10 mb-8 relative overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-r from-primary/10 via-transparent to-secondary/10 opacity-50"></div>

                <div className="bg-base-100/40 backdrop-blur-xl rounded-[2.9rem] p-8 md:p-12 relative z-10">
                  {loading ? (
                    <div className="flex flex-col items-center gap-4 py-10">
                      <span className="loading loading-spinner loading-lg text-primary"></span>
                      <p className="font-bold text-primary">Reading the social graph...</p>
                    </div>
                  ) : error ? (
                    <div className="text-center py-10">
                      <h1 className="text-2xl font-black mb-3">Account not available</h1>
                      <p className="opacity-60 mb-6">{error}</p>
                      <button className="btn btn-primary rounded-full" onClick={() => router.push("/")}>
                        Back to the feed
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-col md:flex-row items-center md:items-start gap-8">
                      <div className="relative group">
                        <div className="absolute inset-0 bg-gradient-to-tr from-primary to-secondary rounded-full blur-2xl opacity-40 group-hover:opacity-60 transition-opacity duration-500"></div>
                        <Avatar
                          accountId={accountId}
                          avatar={profile?.avatar}
                          className="w-32 h-32 md:w-40 md:h-40 border-4 border-white/10 shadow-2xl relative z-10"
                        />
                        <div className="absolute -bottom-2 -right-2 bg-base-100 rounded-full p-2 border border-white/10 shadow-lg z-20">
                          <span className="text-2xl">✨</span>
                        </div>
                      </div>

                      <div className="text-center md:text-left flex-1 min-w-0">
                        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-primary/20 bg-primary/5 text-primary text-[10px] font-bold tracking-widest uppercase mb-4">
                          <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse"></span>
                          {profile?.hasProfile ? "Profile on the social DB" : "Account without a profile"}
                        </div>

                        <div className="flex flex-col gap-6 w-full">
                          <div className="flex flex-wrap justify-between items-center gap-4">
                            <div className="flex items-center gap-4 min-w-0 flex-1 mr-4">
                              <h1 className="text-2xl md:text-3xl lg:text-4xl font-bold tracking-tight text-primary truncate">
                                {profile?.name ?? accountId}
                              </h1>
                              {reputation && (
                                <span className="badge badge-outline border-primary/30 text-primary/80">
                                  {reputation.label}
                                </span>
                              )}
                              <button
                                onClick={copyAccountId}
                                className="btn btn-ghost btn-sm btn-circle text-primary hover:bg-primary/10 transition-all opacity-50 hover:opacity-100 shrink-0"
                                title="Copy account id"
                              >
                                <svg
                                  xmlns="http://www.w3.org/2000/svg"
                                  fill="none"
                                  viewBox="0 0 24 24"
                                  strokeWidth={2}
                                  stroke="currentColor"
                                  className="w-6 h-6"
                                >
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 01-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 011.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 00-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 01-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 00-3.375-3.375h-1.5"
                                  />
                                </svg>
                              </button>
                            </div>

                            <div className="flex items-center gap-4 shrink-0">
                              <FollowButton targetAccountId={accountId} size="lg" />
                              {!isSelf && (
                                <button
                                  onClick={tipAuthor}
                                  disabled={tipping}
                                  className="relative overflow-hidden transition-all duration-300 rounded-full font-bold tracking-wide px-8 py-3 text-sm h-12 min-w-[140px] bg-secondary text-secondary-content shadow-[0_0_15px_rgba(var(--s),0.4)] hover:shadow-[0_0_25px_rgba(var(--s),0.6)] hover:scale-105 active:scale-95 border border-transparent flex items-center justify-center gap-2"
                                  title={`Send ${tipPreference ?? "the default tip"}`}
                                >
                                  {tipping ? (
                                    <span className="loading loading-spinner loading-xs" />
                                  ) : (
                                    <span>{tipPreference ? `Tip ${tipPreference}` : "Tip"}</span>
                                  )}
                                </button>
                              )}
                            </div>
                          </div>

                          <p className="text-sm font-mono opacity-40 break-all">{accountId}</p>

                          {profile?.about && (
                            <div className="relative pl-4 border-l-2 border-primary/30 py-2 max-w-3xl">
                              <p className="text-lg opacity-80 font-light italic leading-relaxed text-left">
                                &quot;{profile.about}&quot;
                              </p>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {!loading && !error && profile && (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                  <div className="flex flex-col gap-8">
                    <div className="premium-glass p-8 rounded-[2.5rem] border border-white/5">
                      <h3 className="text-xs uppercase tracking-widest font-black opacity-30 mb-6">Social stats</h3>
                      <div className="flex flex-wrap gap-3 text-center">
                        <div className="bg-white/5 py-4 px-2 rounded-3xl border border-white/5 flex-1 min-w-[80px]">
                          <span className="block text-2xl md:text-3xl font-black text-primary">{profile.posts}</span>
                          <span className="text-[9px] uppercase opacity-40 font-bold tracking-wide">Posts</span>
                        </div>
                        <div
                          className="bg-white/5 py-4 px-2 rounded-3xl border border-white/5 hover:bg-white/10 transition-colors cursor-pointer group flex-1 min-w-[80px]"
                          onClick={() => setModalType("followers")}
                        >
                          <span className="block text-2xl md:text-3xl font-black text-secondary group-hover:scale-110 transition-transform">
                            {profile.followers}
                          </span>
                          <span className="text-[9px] uppercase opacity-40 font-bold group-hover:opacity-100 transition-opacity tracking-wide">
                            Followers
                          </span>
                        </div>
                        <div
                          className="bg-white/5 py-4 px-2 rounded-3xl border border-white/5 hover:bg-white/10 transition-colors cursor-pointer group flex-1 min-w-[80px]"
                          onClick={() => setModalType("following")}
                        >
                          <span className="block text-2xl md:text-3xl font-black text-secondary group-hover:scale-110 transition-transform">
                            {profile.following}
                          </span>
                          <span className="text-[9px] uppercase opacity-40 font-bold group-hover:opacity-100 transition-opacity tracking-wide">
                            Following
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="premium-glass p-8 rounded-[2.5rem] border border-white/5">
                      <h3 className="text-xs uppercase tracking-widest font-black opacity-30 mb-4">Identity</h3>
                      <p className="text-sm opacity-60 leading-relaxed">
                        Account ids are the namespace and the address on NEAR. Posts, follow edges, and the profile are
                        keyed by this account id in the near.social social DB.
                      </p>
                      {isSelf && (
                        <Link href="/profile" className="btn btn-outline btn-sm rounded-full mt-6">
                          Edit profile
                        </Link>
                      )}
                    </div>
                  </div>

                  <div className="lg:col-span-2">
                    <div className="premium-glass rounded-[2.5rem] overflow-hidden border border-white/5 flex flex-col min-h-[400px]">
                      <div className="px-10 py-6 bg-white/5 border-b border-white/5 flex justify-between items-center">
                        <h3 className="text-xl font-black">Posts</h3>
                        <div className="badge badge-outline opacity-40 font-mono text-[10px]">SOCIAL-KV/1</div>
                      </div>

                      <div className="flex flex-col gap-6 p-6">
                        {posts.length === 0 ? (
                          <div className="flex flex-col items-center justify-center p-24 text-center">
                            <div className="text-6xl mb-4 opacity-20">🪐</div>
                            <p className="text-xl font-bold opacity-30 italic">No posts indexed for this account.</p>
                          </div>
                        ) : (
                          posts.map(item => (
                            <div key={item.post.key} className="transform hover:-translate-y-1 transition-transform">
                              <CastCard post={item.post} repostedBy={item.reposted_by} />
                            </div>
                          ))
                        )}

                        {cursor && (
                          <button
                            className="btn btn-outline btn-wide rounded-full self-center"
                            onClick={() => {
                              void loadMore();
                            }}
                            disabled={loadingMore}
                          >
                            {loadingMore ? "Loading..." : "Load older posts"}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {modalType && (
        <FollowListModal
          isOpen
          onClose={() => setModalType(null)}
          title={modalType === "followers" ? "Followers" : "Following"}
          accountId={accountId}
          kind={modalType}
        />
      )}
    </AccountGuard>
  );
}
