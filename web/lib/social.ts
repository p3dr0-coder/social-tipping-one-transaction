import { teraToGas } from "near-api-js";
import { nearConfig } from "~~/near.config";
import type { SignAndSendTransactionParams } from "./near-provider";
import {
  createPost as createTestnetPost,
  follow as testnetFollow,
  setProfile as testnetSetProfile,
  testnetAccountFeed,
  testnetAccountProfile,
  testnetActivityFeed,
  testnetFollowers,
  testnetFollowing,
} from "./social-testnet";

/** Minimal wallet surface the social and tipping helpers need. */
export type WalletConnection = {
  accountId: string | null;
  signAndSendTransaction: (params: SignAndSendTransactionParams) => Promise<unknown>;
};

export type AccountSummary = {
  account_id: string;
  name?: string | null;
  avatar_url?: string | null;
};

export type Post = {
  key: string;
  id: string;
  author: AccountSummary;
  text: string;
  created_at?: number | null;
  block_height: number;
  // Present only when a feed request carried `?viewer=`: api2 adds per-viewer flags.
  // `following`/`followed_by` are profile-level and live on AccountProfile/AccountCard.
  viewer?: { liked?: boolean; reposted?: boolean };
};

export type FeedItem = {
  type: "post" | "repost";
  post: Post;
  reposted_by?: AccountSummary | null;
  reposted_at?: number | null;
};

export type FeedPage<T> = {
  items: T[];
  next_cursor: string | null;
};

export type AccountCard = {
  account_id: string;
  name?: string | null;
  avatar_url?: string | null;
  about?: string | null;
  followers?: number;
  viewer?: { following?: boolean; followed_by?: boolean };
};

export type AccountProfile = {
  accountId: string;
  hasProfile: boolean;
  name: string | null;
  about: string;
  avatar: string | null;
  avatarUrl: string | null;
  followers: number;
  following: number;
  posts: number;
  viewerFollowing?: boolean;
  viewerFollowedBy?: boolean;
};

export type IndexerStatus = {
  standard: string;
  chain_id: string;
  social_account_id: string;
  last_block_height: number;
  last_block_ts: number;
  lag_ms: number;
  counts: { accounts: number; posts: number; likes: number; follows: number };
};

export type StreamBlock = {
  block_height: number;
  block_ts: number;
  tx_hashes: string[];
  posts: string[];
  accounts: string[];
};

export type NotificationKind = "like" | "repost" | "reply" | "quote" | "mention" | "follow";

export type NotificationItem = {
  kind: NotificationKind;
  actors: AccountSummary[];
  actor_count: number;
  post: Post | null;
  created_at: number;
  cursor?: string | null;
};

type IndexerKeyStatus = { key?: string; status?: string; reason?: string };
type IndexerAction = { kind?: string; status?: string; keys?: IndexerKeyStatus[] };
type IndexerTx = {
  tx_hash?: string;
  indexed?: boolean;
  actions?: IndexerAction[];
  file?: { path?: string; deleted?: boolean };
};

type ApiProfile = {
  account_id: string;
  has_profile?: boolean;
  name?: string | null;
  about?: string | null;
  avatar?: string | null;
  avatar_url?: string | null;
  counts?: { followers?: number; following?: number; posts?: number };
  viewer?: { following?: boolean; followed_by?: boolean };
};

type ApiAccountCard = {
  account_id: string;
  name?: string | null;
  avatar_url?: string | null;
  about?: string | null;
  followers?: number;
  viewer?: { following?: boolean; followed_by?: boolean };
};

/**
 * Quotas enforced by the FastData indexer, per UTC day unless stated otherwise.
 * Over-quota writes come back as `rate_limited` from the indexer.
 */
export const QUOTAS = {
  postsPerDay: 300,
  likesPerDay: 1_000,
  repostsPerDay: 300,
  followsPerDay: 5_000,
  uploadBytesPerDay: 5 * 1024 * 1024,
  keysPerTx: 256,
  keyBytes: 1_024,
  valueBytes: 256 * 1024,
  txBytes: 1.5 * 1024 * 1024,
} as const;

const ACCOUNT_ID_PATTERN = /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;

export function isValidAccountId(accountId: string): boolean {
  return accountId.length >= 2 && accountId.length <= 64 && ACCOUNT_ID_PATTERN.test(accountId);
}

export function isImplicitAccountId(accountId: string): boolean {
  return /^[0-9a-f]{64}$/.test(accountId);
}

export function isNamedAccountId(accountId: string): boolean {
  return isValidAccountId(accountId) && !isImplicitAccountId(accountId);
}

const REPUTATION_TIERS = [
  { minimumFollowers: 1_000, label: "Luminary" },
  { minimumFollowers: 100, label: "Steward" },
  { minimumFollowers: 10, label: "Contributor" },
] as const;

/**
 * Reputation is derived client-side from the indexer's follower count.
 * Tiers change a label only; no contract state backs them.
 */
export function reputationFor(followers: number): { label: string; minimumFollowers: number } | null {
  return REPUTATION_TIERS.find(tier => followers >= tier.minimumFollowers) ?? null;
}

export function extractTxHash(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  if ("transaction" in value) {
    const transaction = value.transaction;
    if (transaction && typeof transaction === "object" && "hash" in transaction && typeof transaction.hash === "string") {
      return transaction.hash;
    }
  }
  if ("transaction_outcome" in value) {
    const outcome = value.transaction_outcome;
    if (outcome && typeof outcome === "object" && "id" in outcome && typeof outcome.id === "string") {
      return outcome.id;
    }
  }
  if ("context" in value) {
    const context = value.context;
    if (
      context &&
      typeof context === "object" &&
      "transactionHash" in context &&
      typeof context.transactionHash === "string"
    ) {
      return context.transactionHash;
    }
  }
  return null;
}

function toError(value: unknown): Error {
  if (value instanceof Error) return value;
  if (typeof value === "string") return new Error(value);
  try {
    return new Error(JSON.stringify(value));
  } catch {
    return new Error("the wallet returned an unreadable error");
  }
}

function assertWriteBudget(data: Record<string, unknown>): void {
  const keys = Object.keys(data);
  if (keys.length > QUOTAS.keysPerTx) {
    throw new Error(`a single write carries at most ${QUOTAS.keysPerTx} keys`);
  }
  // Limits are bytes, not UTF-16 code units; multi-byte text must not slip past them.
  const encoder = new TextEncoder();
  for (const key of keys) {
    if (encoder.encode(key).byteLength > QUOTAS.keyBytes) {
      throw new Error(`key "${key}" exceeds ${QUOTAS.keyBytes} bytes`);
    }
    if (encoder.encode(JSON.stringify(data[key]) ?? "").byteLength > QUOTAS.valueBytes) {
      throw new Error(`the value for "${key}" exceeds ${QUOTAS.valueBytes} bytes`);
    }
  }
  const txBytes = encoder.encode(JSON.stringify(data)).byteLength;
  if (txBytes > QUOTAS.txBytes) {
    throw new Error(`the write is ${txBytes} bytes; a transaction carries at most ${QUOTAS.txBytes}`);
  }
}

/**
 * Writes key/value pairs to the FastData receiver.
 *
 * The receiver has no contract code, so the wallet may surface `CodeDoesNotExist` even when
 * the transaction and its receipts succeeded. The hash is still recoverable from that
 * answer, so the caller confirms it through the indexer instead of retrying the write.
 */
export async function kvWrite(args: Record<string, unknown>, wallet: WalletConnection): Promise<string> {
  if (!wallet.accountId) throw new Error("connect a wallet before writing");
  assertWriteBudget(args);

  const settled = await wallet
    .signAndSendTransaction({
      receiverId: nearConfig.socialReceiver,
      actions: [
        {
          type: "FunctionCall",
          params: {
            methodName: "__fastdata_kv",
            args,
            gas: teraToGas("1").toString(),
            deposit: "0",
          },
        },
      ],
    })
    .catch((error: unknown) => error);

  const hash = extractTxHash(settled);
  if (hash) return hash;
  throw toError(settled);
}

function isIndexerTx(value: unknown): value is IndexerTx {
  if (!value || typeof value !== "object") return false;
  if ("indexed" in value && value.indexed !== undefined && typeof value.indexed !== "boolean") return false;
  if (!("actions" in value) || value.actions === undefined) return true;
  if (!Array.isArray(value.actions)) return false;
  return value.actions.every(action => {
    if (!action || typeof action !== "object") return false;
    if (!("keys" in action) || action.keys === undefined) return true;
    return Array.isArray(action.keys);
  });
}

function isStreamBlock(value: unknown): value is StreamBlock {
  if (!value || typeof value !== "object") return false;
  return (
    "block_height" in value &&
    typeof value.block_height === "number" &&
    "tx_hashes" in value &&
    Array.isArray(value.tx_hashes) &&
    "posts" in value &&
    Array.isArray(value.posts) &&
    "accounts" in value &&
    Array.isArray(value.accounts)
  );
}

export type ConfirmTxOptions = {
  timeoutMs?: number;
  intervalMs?: number;
  fallback?: () => Promise<boolean>;
};

/**
 * Polls the indexer until a transaction is indexed and every action and key reports `ok`.
 * Failure statuses are surfaced with the key and status that produced them.
 *
 * `/v1/tx` keeps roughly 200k transactions, so a slow poll can miss a real write. When
 * `fallback` is provided and the hash never appears (timeout, including a 404 past
 * retention), the read-side check runs: `true` returns a synthetic indexed result and
 * `false` throws. The write itself is never retried.
 */
export async function confirmTx(hash: string, options: ConfirmTxOptions = {}): Promise<IndexerTx> {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const intervalMs = options.intervalMs ?? 1_500;
  const startedAt = Date.now();

  for (;;) {
    const response = await fetch(`${nearConfig.socialApiBase}/v1/tx/${hash}`, { cache: "no-store" });
    if (response.ok) {
      const payload: unknown = await response.json();
      if (!isIndexerTx(payload)) {
        throw new Error(`indexer returned an unexpected response for ${hash}`);
      }
      if (payload.indexed) {
        const actions = payload.actions;
        if (!Array.isArray(actions) || actions.length === 0) {
          // `indexed:true` without actions is not proof that a key was applied.
          throw new Error(`social write ${hash} was indexed but the indexer reported no actions`);
        }
        const failedAction = actions.find(action => action.status !== "ok");
        if (failedAction) {
          throw new Error(
            `social write ${hash} was indexed but the ${failedAction.kind ?? "unknown"} action reported ${failedAction.status}`,
          );
        }
        const failedKey = actions.flatMap(action => action.keys ?? []).find(key => key.status !== "ok");
        if (failedKey) {
          throw new Error(
            `social write ${hash} was indexed but key ${failedKey.key ?? "unknown"} reported ${failedKey.status}`,
          );
        }
        return payload;
      }
    } else if (response.status !== 404) {
      const body = await response.text();
      throw new Error(`indexer lookup for ${hash} failed: ${response.status} ${body}`);
    }

    if (Date.now() - startedAt > timeoutMs) {
      const timeoutError = new Error(
        `social write ${hash} was not indexed within ${Math.round(timeoutMs / 1_000)} s`,
      );
      if (options.fallback) {
        let observed: boolean;
        try {
          observed = await options.fallback();
        } catch (cause) {
          throw new Error(`${timeoutError.message}, and the read-side check failed: ${toError(cause).message}`);
        }
        if (observed) {
          // The indexer never reported the hash, but the written state is readable, so the
          // write did land (usually an aged-out `/v1/tx` entry). Never resend the write.
          return { tx_hash: hash, indexed: true, actions: [] };
        }
        throw new Error(`${timeoutError.message}, and the write is not visible on the read side`);
      }
      throw timeoutError;
    }
    await delay(intervalMs);
  }
}

async function fetchJson<T>(path: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
  const url = new URL(`${nearConfig.socialApiBase}${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  const response = await fetch(url, { headers: { accept: "application/json" }, cache: "no-store" });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${path} failed: ${response.status} ${body}`);
  }
  const payload: unknown = await response.json();
  // Fetch boundary: callers name the shape they expect from the documented endpoint.
  return payload as T;
}

function delay(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

function clampLimit(limit: number | undefined): number {
  return Math.min(Math.max(limit ?? 20, 1), 100);
}

// `viewer` is the signed-in account: api2 then adds `viewer.liked` / `viewer.reposted` to each
// post. The testnet SocialDB adapter has no per-viewer flags and ignores the argument.
export function fetchGlobalFeed(cursor?: string, limit?: number, viewer?: string): Promise<FeedPage<FeedItem>> {
  if (nearConfig.network === "testnet") return testnetActivityFeed(clampLimit(limit));
  return fetchJson<FeedPage<FeedItem>>("/v1/feed/global", { limit: clampLimit(limit), cursor, viewer });
}

export function fetchFollowingFeed(
  accountId: string,
  cursor?: string,
  limit?: number,
  viewer?: string,
): Promise<FeedPage<FeedItem>> {
  if (nearConfig.network === "testnet") return testnetAccountFeed(accountId, clampLimit(limit));
  return fetchJson<FeedPage<FeedItem>>(`/v1/feed/following/${encodeURIComponent(accountId)}`, {
    limit: clampLimit(limit),
    cursor,
    viewer,
  });
}

export async function fetchAccount(accountId: string, viewer?: string | null): Promise<AccountProfile> {
  if (!isValidAccountId(accountId)) throw new Error(`"${accountId}" is not a valid account id`);
  if (nearConfig.network === "testnet") return testnetAccountProfile(accountId);

  const profile = await fetchJson<ApiProfile>(`/v1/accounts/${encodeURIComponent(accountId)}`, {
    viewer: viewer ?? undefined,
  });
  return {
    accountId: profile.account_id,
    hasProfile: profile.has_profile ?? false,
    name: profile.name ?? null,
    about: profile.about ?? "",
    avatar: profile.avatar ?? null,
    avatarUrl: profile.avatar_url ?? null,
    followers: profile.counts?.followers ?? 0,
    following: profile.counts?.following ?? 0,
    posts: profile.counts?.posts ?? 0,
    viewerFollowing: profile.viewer?.following,
    viewerFollowedBy: profile.viewer?.followed_by,
  };
}

export function fetchAccountPosts(
  accountId: string,
  cursor?: string,
  limit?: number,
  viewer?: string,
): Promise<FeedPage<FeedItem>> {
  if (nearConfig.network === "testnet") return testnetAccountFeed(accountId, clampLimit(limit));
  return fetchJson<FeedPage<FeedItem>>(`/v1/accounts/${encodeURIComponent(accountId)}/posts`, {
    limit: clampLimit(limit),
    cursor,
    viewer,
  });
}

async function testnetAccountsFromActivity(excluded: string[]): Promise<AccountCard[]> {
  const page = await testnetActivityFeed(100);
  const seen = new Map<string, AccountCard>();
  for (const item of page.items) {
    const accountId = item.post.author.account_id;
    if (excluded.includes(accountId) || seen.has(accountId)) continue;
    seen.set(accountId, { account_id: accountId });
  }
  return [...seen.values()];
}

export async function searchAccounts(query: string): Promise<AccountCard[]> {
  const trimmed = query.trim().toLowerCase();
  if (trimmed.length === 0) return [];
  if (nearConfig.network === "testnet") {
    const accounts = await testnetAccountsFromActivity([]);
    return accounts.filter(card => card.account_id.includes(trimmed));
  }
  const page = await fetchJson<FeedPage<ApiAccountCard>>("/v1/search/accounts", { q: trimmed });
  return page.items;
}

export async function fetchSuggestions(viewer: string): Promise<AccountCard[]> {
  if (nearConfig.network === "testnet") {
    return testnetAccountsFromActivity([viewer]);
  }
  const page = await fetchJson<FeedPage<ApiAccountCard>>("/v1/suggestions", { viewer });
  return page.items;
}

export function fetchFollowers(accountId: string, cursor?: string, limit?: number): Promise<FeedPage<AccountCard>> {
  if (nearConfig.network === "testnet") return testnetFollowers(accountId);
  return fetchJson<FeedPage<AccountCard>>(`/v1/accounts/${encodeURIComponent(accountId)}/followers`, {
    limit: clampLimit(limit),
    cursor,
  });
}

export function fetchFollowing(accountId: string, cursor?: string, limit?: number): Promise<FeedPage<AccountCard>> {
  if (nearConfig.network === "testnet") return testnetFollowing(accountId);
  return fetchJson<FeedPage<AccountCard>>(`/v1/accounts/${encodeURIComponent(accountId)}/following`, {
    limit: clampLimit(limit),
    cursor,
  });
}

export async function fetchNotifications(
  accountId: string,
  cursor?: string,
  limit?: number,
): Promise<FeedPage<NotificationItem>> {
  if (!isValidAccountId(accountId)) throw new Error(`"${accountId}" is not a valid account id`);
  if (nearConfig.network === "testnet") {
    // api2 indexes mainnet `social` only, and SocialDB has no derived notifications,
    // so an empty page is the honest testnet answer.
    return { items: [], next_cursor: null };
  }
  return fetchJson<FeedPage<NotificationItem>>(`/v1/notifications/${encodeURIComponent(accountId)}`, {
    limit: clampLimit(limit),
    cursor,
  });
}

export async function isFollowing(target: string, viewer: string): Promise<boolean> {
  if (viewer === target) return false;
  const profile = await fetchAccount(target, viewer);
  if (profile.viewerFollowing !== undefined) return profile.viewerFollowing;

  let cursor: string | undefined;
  for (;;) {
    const page = await fetchFollowing(viewer, cursor);
    if (page.items.some(card => card.account_id === target)) return true;
    if (!page.next_cursor) return false;
    cursor = page.next_cursor;
  }
}

export function streamUpdates(onBlock: (block: StreamBlock) => void): () => void {
  if (typeof window === "undefined" || typeof EventSource === "undefined") {
    // No stream exists during server rendering, so there is nothing to close.
    return () => {};
  }
  if (nearConfig.network === "testnet") {
    // api2 is mainnet-only; the testnet SocialDB adapter has no equivalent SSE endpoint.
    return () => {};
  }
  const source = new EventSource(`${nearConfig.socialApiBase}/v1/stream`);
  source.addEventListener("block", event => {
    if (!(event instanceof MessageEvent)) return;
    try {
      const block: unknown = JSON.parse(event.data);
      if (isStreamBlock(block)) onBlock(block);
    } catch {
      // Ignore a malformed frame and keep the stream open for the next block.
    }
  });
  return () => source.close();
}

export function getIndexerStatus(): Promise<IndexerStatus> {
  return fetchJson<IndexerStatus>("/v1/status");
}

let lastPostId = 0;

/** Monotonic per-session post id so two posts in the same millisecond never collide. */
export function nextPostId(now: number = Date.now()): string {
  const id = Math.max(now, lastPostId + 1);
  lastPostId = id;
  return String(id);
}

/** Publishes a post and resolves once the indexer has accepted every key. */
export async function createPost(text: string, wallet: WalletConnection): Promise<string> {
  const body = text.trim();
  if (body.length === 0) throw new Error("write something before posting");
  const accountId = wallet.accountId;
  if (!accountId) throw new Error("connect a wallet before posting");

  const id = nextPostId();
  if (nearConfig.network === "testnet") {
    return createTestnetPost(wallet, body);
  }
  const hash = await kvWrite({ [`post/${id}`]: { text: body } }, wallet);
  await confirmTx(hash, {
    fallback: async () => {
      const page = await fetchAccountPosts(accountId, undefined, 100);
      return page.items.some(item => item.post.id === id);
    },
  });
  return hash;
}

/** Follows or unfollows `target` by writing the edge as `{}` or `null`. */
export async function setFollow(target: string, on: boolean, wallet: WalletConnection): Promise<string> {
  const accountId = wallet.accountId;
  if (!accountId) throw new Error("connect a wallet before following");
  const targetId = target.trim().toLowerCase();
  if (!isValidAccountId(targetId)) throw new Error(`"${target}" is not a valid account id`);
  if (targetId === accountId) throw new Error("you cannot follow yourself");

  if (nearConfig.network === "testnet") {
    return testnetFollow(wallet, targetId, on);
  }
  const hash = await kvWrite({ [`graph/follow/${targetId}`]: on ? {} : null }, wallet);
  await confirmTx(hash, {
    fallback: async () => (await isFollowing(targetId, accountId)) === on,
  });
  return hash;
}

export type ProfileUpdate = {
  about: string;
  name: string;
  avatar?: string | null;
};

/** Writes the profile fields as one batch (three keys, well below the 256-key limit). */
export async function saveProfile(update: ProfileUpdate, wallet: WalletConnection): Promise<string> {
  const accountId = wallet.accountId;
  if (!accountId) throw new Error("connect a wallet before saving a profile");
  const about = update.about.trim();
  const name = update.name.trim();
  if (about.length > 10_000) throw new Error("the bio must be at most 10,000 characters");
  if (name.length > 64) throw new Error("the display name must be at most 64 characters");

  if (nearConfig.network === "testnet") {
    return testnetSetProfile(wallet, { name, about, avatar: update.avatar ?? null });
  }

  const data: Record<string, unknown> = {
    "profile/about": about,
    "profile/name": name,
  };
  if (update.avatar !== undefined) data["profile/avatar"] = update.avatar;

  const hash = await kvWrite(data, wallet);
  await confirmTx(hash, {
    fallback: async () => {
      const profile = await fetchAccount(accountId);
      if (profile.about !== about || (profile.name ?? "") !== name) return false;
      if (update.avatar !== undefined && profile.avatar !== update.avatar) return false;
      return true;
    },
  });
  return hash;
}
