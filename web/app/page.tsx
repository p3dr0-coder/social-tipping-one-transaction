"use client";

import type { NextPage } from "next";
import { AccountGuard } from "~~/components/social/AccountGuard";
import { Compose } from "~~/components/social/Compose";
import { Feed } from "~~/components/social/Feed";
import { Sidebar } from "~~/components/social/Sidebar";
import { Suggestions } from "~~/components/social/Suggestions";

const Home: NextPage = () => {
  return (
    <AccountGuard>
      <div className="max-w-6xl mx-auto px-4 py-8">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-8">
          <div className="hidden md:block md:col-span-4 lg:col-span-3">
            <Sidebar />
          </div>

          <div className="col-span-1 md:col-span-8 lg:col-span-6">
            <div className="flex flex-col gap-6">
              <Compose />
              <Feed />
            </div>
          </div>

          <div className="hidden lg:block lg:col-span-3">
            <div className="flex flex-col gap-6 sticky top-24">
              <Suggestions />

              <div className="glass-panel p-6 rounded-[1.5rem] border border-white/5 opacity-50 hover:opacity-100 transition-opacity">
                <p className="text-[10px] font-bold uppercase tracking-widest opacity-40 leading-relaxed">
                  near.social social DB
                  <br />
                  social-kv/1 FastData KV
                </p>
                <div className="mt-2 h-1 w-8 bg-primary/30 rounded-full"></div>
                <p className="mt-4 text-[9px] opacity-30 leading-tight">
                  No database. No server-side accounts.
                  <br />
                  The graph is public data.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </AccountGuard>
  );
};

export default Home;
