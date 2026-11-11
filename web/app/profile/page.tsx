"use client";

import { useEffect, useState, type ChangeEvent } from "react";
import { teraToGas } from "near-api-js";
import { AccountGuard } from "~~/components/social/AccountGuard";
import { Avatar } from "~~/components/social/Avatar";
import { Sidebar } from "~~/components/social/Sidebar";
import { nearConfig } from "~~/near.config";
import { uploadAvatar } from "~~/lib/fastfs";
import { useNear } from "~~/lib/near-provider";
import { fetchAccount, saveProfile } from "~~/lib/social";
import { getTipPreference, getTipToken, parseUnits, type TipToken } from "~~/lib/tips";
import { notification } from "~~/utils/notification";

const TIP_STORAGE_DEPOSIT = "10000000000000000000000";

export default function ProfilePage() {
  const { accountId, signAndSendTransaction } = useNear();

  const [about, setAbout] = useState("");
  const [name, setName] = useState("");
  const [avatar, setAvatar] = useState<string | null>(null);
  const [tipPreference, setTipPreference] = useState("0.1");
  const [token, setToken] = useState<TipToken | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingTip, setSavingTip] = useState(false);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;
    setLoading(true);
    Promise.all([fetchAccount(accountId), getTipPreference(accountId), getTipToken()])
      .then(([profile, preference, tipToken]) => {
        if (cancelled) return;
        setAbout(profile.about);
        setName(profile.name ?? "");
        setAvatar(profile.avatar);
        setTipPreference(preference);
        setToken(tipToken);
      })
      .catch(cause => {
        if (!cancelled) {
          notification.error(cause instanceof Error ? cause.message : "The profile could not be loaded");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [accountId]);

  const handleAvatarChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !accountId) return;

    setUploading(true);
    try {
      const uri = await uploadAvatar(file, { accountId, signAndSendTransaction });
      setAvatar(uri);
      notification.success("Avatar uploaded to FastFS. Save the profile to publish it.");
    } catch (cause) {
      notification.error(cause instanceof Error ? cause.message : "The avatar could not be uploaded");
    } finally {
      setUploading(false);
    }
  };

  const submitProfile = async () => {
    if (!accountId) return;
    setSavingProfile(true);
    try {
      await saveProfile({ about, name, avatar }, { accountId, signAndSendTransaction });
      notification.success("Profile saved to the social DB");
    } catch (cause) {
      notification.error(cause instanceof Error ? cause.message : "The profile could not be saved");
    } finally {
      setSavingProfile(false);
    }
  };

  const submitTipPreference = async () => {
    if (!accountId || !token) return;
    setSavingTip(true);
    try {
      // Validate before spending gas; the contract re-validates against its bound decimals.
      parseUnits(tipPreference.trim(), token.decimals);
      await signAndSendTransaction({
        receiverId: nearConfig.philiaContract,
        actions: [
          {
            type: "FunctionCall",
            params: {
              methodName: "set_tip_preference",
              args: { amount: tipPreference.trim() },
              gas: teraToGas("30").toString(),
              deposit: TIP_STORAGE_DEPOSIT,
            },
          },
        ],
      });
      notification.success("Tip preference stored on-chain");
    } catch (cause) {
      notification.error(cause instanceof Error ? cause.message : "The tip preference could not be saved");
    } finally {
      setSavingTip(false);
    }
  };

  return (
    <AccountGuard>
      <div className="min-h-screen bg-base-100 relative overflow-hidden">
        <div className="absolute top-[-20%] right-[-10%] w-[800px] h-[800px] bg-primary/10 rounded-full blur-[150px] pointer-events-none animate-pulse-slow"></div>
        <div className="absolute bottom-[-20%] left-[-10%] w-[800px] h-[800px] bg-secondary/10 rounded-full blur-[150px] pointer-events-none animate-float"></div>

        <div className="max-w-7xl mx-auto px-6 py-12 relative z-10">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
            <div className="hidden lg:block lg:col-span-3">
              <Sidebar />
            </div>

            <div className="col-span-1 lg:col-span-9">
              <div className="glass-panel rounded-[3rem] p-1 border border-white/10 mb-8 relative overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-r from-primary/10 via-transparent to-secondary/10 opacity-50"></div>

                <div className="bg-base-100/40 backdrop-blur-xl rounded-[2.9rem] p-8 md:p-12 relative z-10">
                  <div className="flex flex-col md:flex-row items-center md:items-start gap-8">
                    <div className="relative group">
                      <div className="absolute inset-0 bg-gradient-to-tr from-primary to-secondary rounded-full blur-2xl opacity-40 group-hover:opacity-60 transition-opacity duration-500"></div>
                      <Avatar
                        accountId={accountId ?? "unknown"}
                        avatar={avatar}
                        className="w-32 h-32 md:w-40 md:h-40 border-4 border-white/10 shadow-2xl relative z-10"
                      />
                    </div>

                    <div className="text-center md:text-left flex-1">
                      <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-primary/20 bg-primary/5 text-primary text-[10px] font-bold tracking-widest uppercase mb-4">
                        <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse"></span>
                        {nearConfig.network}
                      </div>
                      <h1 className="text-3xl md:text-4xl font-bold tracking-tight text-primary truncate max-w-xl">
                        {name || accountId || "Anonymous"}
                      </h1>
                      <p className="text-sm font-mono opacity-50 mt-2 break-all">{accountId}</p>
                      <p className="text-lg opacity-60 font-light max-w-xl mx-auto md:mx-0 leading-relaxed mt-4">
                        Your bio, avatar, and tip preference live in public storage. Changes are written as individual
                        keys and appear after the indexer confirms them.
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="premium-glass p-10 rounded-[3rem] border border-white/10 shadow-3xl relative overflow-hidden">
                <h2 className="text-3xl font-black mb-10 flex items-center gap-4">
                  <span className="text-3xl">📝</span>
                  Edit profile
                  <div className="h-px flex-1 bg-gradient-to-r from-white/10 to-transparent ml-4"></div>
                </h2>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-10 mb-10">
                  <div className="flex flex-col gap-3">
                    <label className="text-[10px] uppercase tracking-[0.2em] font-black opacity-40 px-2">
                      Account id
                    </label>
                    <div className="relative">
                      <input
                        type="text"
                        value={accountId ?? ""}
                        disabled
                        readOnly
                        className="w-full bg-white/5 border border-white/5 rounded-[1.5rem] px-6 py-4 text-lg font-mono opacity-50 cursor-not-allowed outline-none"
                      />
                      <div className="absolute right-6 top-1/2 -translate-y-1/2 flex items-center gap-2">
                        <span className="text-[10px] font-mono opacity-30">NAMED ACCOUNT</span>
                        <span className="text-xl">🛡️</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col gap-3">
                    <label className="text-[10px] uppercase tracking-[0.2em] font-black opacity-40 px-2">
                      Display name
                    </label>
                    <input
                      type="text"
                      value={name}
                      onChange={event => setName(event.target.value)}
                      maxLength={64}
                      className="w-full bg-base-100/50 border border-white/10 rounded-[1.5rem] px-6 py-4 text-xl font-bold focus:border-primary/50 focus:ring-4 focus:ring-primary/10 transition-all outline-none"
                    />
                    <p className="text-[10px] opacity-30 px-2 leading-relaxed italic">
                      Stored as profile/name. The account id remains the canonical identity.
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-10 mb-10">
                  <div className="flex flex-col gap-3">
                    <label className="text-[10px] uppercase tracking-[0.2em] font-black text-secondary px-2">
                      Preferred tip amount
                    </label>
                    <div className="relative">
                      <input
                        type="text"
                        value={tipPreference}
                        onChange={event => setTipPreference(event.target.value)}
                        className="w-full bg-base-100/50 border border-white/10 rounded-[1.5rem] px-6 py-4 text-xl font-mono focus:border-secondary/50 focus:ring-4 focus:ring-secondary/10 transition-all outline-none"
                      />
                      <div className="absolute right-6 top-1/2 -translate-y-1/2 text-[10px] font-mono opacity-40">
                        NEP-141
                      </div>
                    </div>
                    <p className="text-[10px] opacity-30 px-2 leading-relaxed italic">
                      {token
                        ? `Parsed with ${token.decimals} decimals for ${token.ftAccountId.slice(0, 12)}...`
                        : "Token details are loading."}
                    </p>
                    <button
                      onClick={submitTipPreference}
                      disabled={savingTip || loading || !token}
                      className="btn btn-secondary btn-sm rounded-full self-start px-6"
                    >
                      {savingTip ? <span className="loading loading-spinner loading-xs" /> : "Save preference"}
                    </button>
                  </div>

                  <div className="flex flex-col gap-3">
                    <label className="text-[10px] uppercase tracking-[0.2em] font-black text-primary px-2">
                      Avatar
                    </label>
                    <div className="flex items-center gap-4">
                      <Avatar accountId={accountId ?? "unknown"} avatar={avatar} className="w-16 h-16 border border-white/10" />
                      <label className="btn btn-outline btn-sm rounded-full cursor-pointer">
                        {uploading ? "Uploading..." : "Choose image"}
                        <input
                          type="file"
                          accept="image/png,image/jpeg,image/webp"
                          className="hidden"
                          onChange={handleAvatarChange}
                          disabled={uploading}
                        />
                      </label>
                    </div>
                    <p className="text-[10px] opacity-30 px-2 leading-relaxed italic">
                      Encoded to WebP and uploaded to FastFS. Maximum 1 MiB per upload.
                    </p>
                  </div>
                </div>

                <div className="flex flex-col gap-3 mb-12">
                  <label className="text-[10px] uppercase tracking-[0.2em] font-black text-primary px-2">
                    Bio
                  </label>
                  <textarea
                    value={about}
                    onChange={event => setAbout(event.target.value)}
                    maxLength={10_000}
                    className="w-full bg-base-100/50 border border-white/10 rounded-[2rem] p-8 text-lg font-light min-h-[220px] focus:border-primary/50 focus:ring-4 focus:ring-primary/10 transition-all outline-none resize-none leading-relaxed"
                  />
                  <div className="flex justify-between items-center px-2 opacity-30 text-[9px] uppercase tracking-widest font-mono">
                    <span>Public record</span>
                    <span>{`${about.length.toLocaleString()} / 10,000`}</span>
                  </div>
                </div>

                <div className="flex justify-end pt-8 border-t border-white/5">
                  <button
                    onClick={submitProfile}
                    disabled={savingProfile || loading || !accountId}
                    className="btn btn-primary border-none rounded-full h-16 px-12 hover:scale-105 active:scale-95 transition-all font-black text-lg shadow-[0_0_25px_rgba(var(--p),0.4)] flex items-center gap-4 text-white"
                  >
                    {savingProfile ? (
                      <span className="loading loading-spinner"></span>
                    ) : (
                      <>
                        <span>Save profile</span>
                        <span className="text-2xl">⚡</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </AccountGuard>
  );
}
