"use client";

import { useNear } from "~~/lib/near-provider";
import { notification } from "~~/utils/notification";

export const LandingPage = ({ hasNoAccount }: { hasNoAccount?: boolean }) => {
  const { accountId, connect, disconnect } = useNear();

  const handleConnect = async () => {
    try {
      await connect();
    } catch (error) {
      notification.error(error instanceof Error ? error.message : "The wallet could not connect");
    }
  };

  return (
    <div className="min-h-screen bg-base-100 text-base-content relative overflow-hidden flex flex-col">
      <div className="absolute inset-0 z-0 pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-primary/10 rounded-full blur-[120px] animate-pulse-slow"></div>
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-secondary/10 rounded-full blur-[120px] animate-float"></div>
      </div>

      <div className="relative z-10 container mx-auto px-6 pt-24 pb-32 flex-grow">
        <div className="max-w-4xl mx-auto text-center mb-32">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 border border-primary/20 text-xs font-bold tracking-widest uppercase mb-8 text-primary shadow-sm">
            <span className="w-2 h-2 rounded-full bg-primary animate-pulse"></span>
            Sovereign social on NEAR
          </div>

          <h1 className="text-6xl md:text-8xl font-black tracking-tight mb-8">
            phil<span className="text-primary tracking-tighter">ia</span>
          </h1>

          <p className="text-xl md:text-2xl opacity-70 mb-12 max-w-2xl mx-auto font-light leading-relaxed">
            Profiles, posts, follows, and tips stored in the near.social social DB. Your account id is the identity,
            the social graph is public data, and no application database sits in the middle.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
            {!accountId && (
              <button
                onClick={handleConnect}
                className="btn btn-primary btn-lg rounded-full px-12 text-lg shadow-xl hover:scale-105 transition-all font-bold"
              >
                Connect a NEAR wallet
              </button>
            )}
            {accountId && hasNoAccount && (
              <button
                onClick={disconnect}
                className="btn btn-outline btn-lg rounded-full px-12 text-lg border-white/10 hover:bg-white/5 transition-all"
              >
                Disconnect {accountId.slice(0, 8)}...
              </button>
            )}
            <a
              href="https://near.social"
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-outline btn-lg rounded-full px-12 text-lg border-white/10 hover:bg-white/5 transition-all"
            >
              Explore the social DB
            </a>
          </div>

          {hasNoAccount && (
            <div className="mt-10 max-w-2xl mx-auto text-left alert border border-warning/30 bg-warning/10 rounded-2xl">
              <div>
                <h3 className="font-bold">This wallet is an implicit account</h3>
                <p className="text-sm opacity-70 mt-1">
                  {accountId ? `${accountId.slice(0, 16)}... ` : ""}
                  is a 64-character implicit account. The social graph addresses people by named account ids, so use
                  a wallet that holds a named account (for example a sub-account of a named parent) to post, follow,
                  and tip.
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="max-w-6xl mx-auto mb-40">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-black mb-4 uppercase tracking-tighter">What is different</h2>
            <div className="h-1.5 w-20 bg-primary mx-auto rounded-full"></div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {[
              {
                title: "No database",
                desc: "Posts are keys in the near.social social DB. The indexer derives feeds; the app keeps no copy of your data.",
                icon: "⛓️",
                color: "bg-blue-500/10 text-blue-500",
              },
              {
                title: "Portable identity",
                desc: "Your NEAR account id is the namespace and the address. The profile travels with the account.",
                icon: "🕊️",
                color: "bg-purple-500/10 text-purple-500",
              },
              {
                title: "Open social graph",
                desc: "Follow edges are individual keys, so followers and following are computed from public data.",
                icon: "📈",
                color: "bg-green-500/10 text-green-500",
              },
              {
                title: "Native tipping",
                desc: "Tips settle as NEP-141 transfers. Each deployment of the tips contract prices exactly one token.",
                icon: "💰",
                color: "bg-yellow-500/10 text-yellow-500",
              },
              {
                title: "Stored preferences",
                desc: "A small Rust contract stores each account's tip preference and charges only for storage it grows.",
                icon: "🧾",
                color: "bg-orange-500/10 text-orange-500",
              },
              {
                title: "Open source",
                desc: "MIT licensed, with the origin project and the baseline framework disclosed in NOTICE and ATTRIBUTION.",
                icon: "📂",
                color: "bg-teal-500/10 text-teal-500",
              },
            ].map(feature => (
              <div
                key={feature.title}
                className="bg-base-200/50 p-8 rounded-[2rem] border border-white/5 hover:border-primary/20 transition-all hover:-translate-y-1 group"
              >
                <div className={`w-14 h-14 flex items-center justify-center rounded-2xl ${feature.color} text-2xl mb-6 shadow-inner`}>
                  {feature.icon}
                </div>
                <h3 className="text-xl font-bold mb-3">{feature.title}</h3>
                <p className="opacity-60 text-sm leading-relaxed">{feature.desc}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="max-w-3xl mx-auto mb-20">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-black uppercase tracking-tighter">Common questions</h2>
          </div>
          <div className="space-y-4">
            {[
              {
                q: "Which account do I need?",
                a: "A named NEAR account. Implicit 64-character accounts have no readable name for the social graph, so the app asks you to switch.",
              },
              {
                q: "What does posting cost?",
                a: "One 1 Tgas function call to the social receiver with no attached deposit. Run demo/measure.mjs to record the gas and fee the chain reports for your own posts.",
              },
              {
                q: "Where does the social data live?",
                a: "In the near.social social DB: the social-kv/1 FastData receiver on mainnet, and the SocialDB contract on testnet.",
              },
              {
                q: "Who can read my posts?",
                a: "Everyone. Social writes are public by design; do not post anything you need to keep private.",
              },
            ].map(item => (
              <div key={item.q} className="collapse collapse-arrow bg-base-200/50 border border-white/5 rounded-2xl overflow-hidden">
                <input type="radio" name="faq-accordion" />
                <div className="collapse-title text-lg font-bold p-6">{item.q}</div>
                <div className="collapse-content px-6 pb-6 opacity-60">
                  <p>{item.a}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <footer className="relative z-10 py-12 text-center border-t border-white/5 bg-base-200/30 backdrop-blur-sm">
        <div className="container mx-auto px-6 text-sm flex flex-col items-center gap-4">
          <p className="opacity-40 font-medium">philia · MIT · built on the near.social social DB</p>
          <div className="flex gap-6 opacity-60">
            <a href="https://near.social" className="hover:text-primary transition-colors" target="_blank" rel="noreferrer">
              near.social
            </a>
            <a href="https://github.com" className="hover:text-primary transition-colors" target="_blank" rel="noreferrer">
              Source
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
};
