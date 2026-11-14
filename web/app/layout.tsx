import type { Metadata } from "next";
import { Outfit, Syne } from "next/font/google";
import { NotificationToaster } from "~~/utils/notification";
import { Footer } from "~~/components/Footer";
import { Header } from "~~/components/Header";
import { ThemeProvider } from "~~/components/ThemeProvider";
import { ScrollTop } from "~~/components/social/ScrollTop";
import { NearProvider } from "~~/lib/near-provider";
import "~~/styles/globals.css";

const syne = Syne({ subsets: ["latin"], variable: "--font-syne" });
const outfit = Outfit({ subsets: ["latin"], variable: "--font-outfit" });

export const metadata: Metadata = {
  title: "philia — sovereign social on NEAR",
  description:
    "Profiles, posts, follows, and tips stored in the near.social social DB (social-kv/1 FastData KV + SocialDB), with NEP-141 tipping and an on-chain tip preference contract.",
  icons: {
    icon: "/logo.png",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${syne.variable} ${outfit.variable}`}>
      <body>
        <ThemeProvider>
          <NearProvider>
            <div className="flex flex-col min-h-screen">
              <Header />
              <main className="relative flex flex-col flex-1">{children}</main>
              <Footer />
            </div>
            <NotificationToaster />
            <ScrollTop />
          </NearProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
