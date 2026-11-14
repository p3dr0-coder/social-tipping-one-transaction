"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import { nearConfig } from "~~/near.config";

/** Turns a `fastfs://account/social/path` URI into a gateway URL. */
export function fastfsHttpUrl(uri: string | null | undefined): string | null {
  if (!uri) return null;
  if (uri.startsWith("fastfs://")) {
    const rest = uri.slice("fastfs://".length);
    const [accountId, root, ...path] = rest.split("/");
    if (!accountId || !root || path.length === 0) return null;
    return `${nearConfig.fastfsGateway}/${accountId}/${root}/${path.join("/")}`;
  }
  if (uri.startsWith("https://") || uri.startsWith("http://")) return uri;
  return null;
}

/** Deterministic local fallback: a hue and initials derived from the account id. */
export function deterministicAvatar(seed: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619) >>> 0;
  }
  const hue = hash % 360;
  const initials = seed.slice(0, 2).toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="50" fill="hsl(${hue} 62% 46%)"/><text x="50" y="50" fill="white" font-family="sans-serif" font-size="38" font-weight="700" text-anchor="middle" dominant-baseline="central">${initials}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

type AvatarProps = {
  accountId: string;
  avatar?: string | null;
  className?: string;
};

export const Avatar = ({ accountId, avatar, className = "w-10 h-10" }: AvatarProps) => {
  const fallback = useMemo(() => deterministicAvatar(accountId), [accountId]);
  const source = fastfsHttpUrl(avatar) ?? fallback;
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const activeSrc = failedSource === source ? fallback : source;

  return (
    <Image
      src={activeSrc}
      alt={`${accountId} avatar`}
      width={100}
      height={100}
      unoptimized
      className={`${className} rounded-full object-cover`}
      onError={() => setFailedSource(source)}
    />
  );
};
