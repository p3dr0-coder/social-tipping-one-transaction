"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ClipboardDocumentIcon } from "@heroicons/react/24/outline";
import { Avatar } from "./Avatar";
import { FollowModal } from "./FollowModal";
import { SearchUsers } from "./SearchUsers";
import { useNear } from "~~/lib/near-provider";
import { fetchAccount, type AccountProfile } from "~~/lib/social";
import { notification } from "~~/utils/notification";

export const Sidebar = () => {
  const { accountId } = useNear();
  const [profileState, setProfileState] = useState<{ accountId: string; profile: AccountProfile | null } | null>(null);
  const [modalType, setModalType] = useState<"followers" | "following" | null>(null);
  const profile = accountId && profileState?.accountId === accountId ? profileState.profile : null;

  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;
    fetchAccount(accountId)
      .then(next => {
        if (!cancelled) setProfileState({ accountId, profile: next });
      })
      .catch(() => {
        if (!cancelled) setProfileState({ accountId, profile: null });
      });
    return () => {
      cancelled = true;
    };
  }, [accountId]);
  return (
    <div className="flex flex-col gap-6 sticky top-24">
      <SearchUsers />

      <div className="glass-panel p-6 rounded-[2rem] border border-base-content/5 relative group overflow-hidden transition-all hover:border-primary/30">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-transparent to-secondary/10 opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>

        <div className="flex flex-col items-center text-center relative z-10">
          <div className="relative mb-4">
            <div className="absolute inset-0 bg-primary/20 rounded-full blur-xl group-hover:bg-primary/40 transition-all duration-500"></div>
            <div className="w-24 h-24 rounded-full border-2 border-base-content/20 shadow-2xl relative z-10 overflow-hidden group-hover:scale-105 transition-transform duration-300">
              <Avatar accountId={accountId ?? "unknown"} avatar={profile?.avatar} className="w-24 h-24" />
            </div>
          </div>

          <div className="w-full">
            <div className="flex items-center justify-center gap-2 mb-3">
              <h2
                className="font-bold text-xl truncate text-primary/90 max-w-[200px]"
                title={accountId ?? "Not connected"}
              >
                {profile?.name ?? accountId ?? "Not connected"}
              </h2>
              {accountId && (
                <button
                  onClick={() => {
                    void navigator.clipboard.writeText(accountId);
                    notification.success("Account id copied");
                  }}
                  className="btn btn-ghost btn-xs btn-circle text-primary hover:bg-primary/10 transition-all opacity-50 hover:opacity-100"
                  title="Copy account id"
                >
                  <ClipboardDocumentIcon className="w-4 h-4" />
                </button>
              )}
            </div>

            {profile?.about && (
              <p className="text-sm opacity-70 italic line-clamp-2 px-2 mb-4 leading-relaxed font-light">
                {profile.about}
              </p>
            )}

            <div className="grid grid-cols-2 gap-2 border-t border-base-content/5 pt-4">
              <div
                className="text-center p-2 rounded-xl hover:bg-base-content/5 transition-colors cursor-pointer group"
                onClick={() => setModalType("following")}
              >
                <span className="font-black text-lg block group-hover:text-primary transition-colors">
                  {profile?.following ?? 0}
                </span>
                <span className="text-[10px] uppercase tracking-widest opacity-40 group-hover:opacity-100 transition-opacity">
                  Following
                </span>
              </div>
              <div
                className="text-center p-2 rounded-xl hover:bg-base-content/5 transition-colors cursor-pointer group"
                onClick={() => setModalType("followers")}
              >
                <span className="font-black text-lg block group-hover:text-primary transition-colors">
                  {profile?.followers ?? 0}
                </span>
                <span className="text-[10px] uppercase tracking-widest opacity-40 group-hover:opacity-100 transition-opacity">
                  Followers
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {accountId && modalType && (
        <FollowModal
          isOpen
          onClose={() => setModalType(null)}
          title={modalType === "followers" ? "Followers" : "Following"}
          accountId={accountId}
          kind={modalType}
        />
      )}

      <nav className="glass-panel p-3 rounded-[1.5rem] border border-white/5 flex flex-col gap-1">
        {[
          { icon: "🏠", label: "Home", href: "/" },
          { icon: "👤", label: "Profile", href: "/profile" },
          { icon: "📝", label: "My posts", href: accountId ? `/${accountId}` : "/" },
        ].map(link => (
          <Link
            key={link.label}
            href={link.href}
            className="btn btn-ghost justify-start gap-4 rounded-xl h-12 text-lg hover:bg-white/5 hover:pl-6 transition-all duration-300 group"
          >
            <span className="group-hover:scale-125 transition-transform duration-300">{link.icon}</span>
            <span className="font-medium opacity-70 group-hover:opacity-100 group-hover:text-primary transition-colors">
              {link.label}
            </span>
          </Link>
        ))}
      </nav>
      <div className="text-center text-[10px] opacity-20 font-mono tracking-widest">philia · near.social social DB</div>
    </div>
  );
};
