import { teraToGas } from "near-api-js";
import { Social } from "near-social-js";
import type { IndexEntry } from "near-social-js";
import { nearConfig } from "~~/near.config";
import type { AccountCard, AccountProfile, FeedItem, FeedPage, Post, WalletConnection } from "./social";

/**
 * Testnet SocialDB adapter.
 *
 * `social.near` and `v1.social08.testnet` are two separate deployments of the social
 * contract. The FastData indexer behind `api2.near.social` only follows mainnet writes, so
 * the testnet path reads the SocialDB contract through near-social-js and writes through a
 * wallet-signed `set` call. The zero-funds demo script reads the contract's own `get`/`keys`
 * views for ground truth.
 */

let client: Social | null = null;

export function getTestnetSocial(): Social {
  if (!client) {
    client = new Social({ network: "testnet", contractId: nearConfig.socialDbContractId });
  }
  return client;
}

const SOCIALDB_WRITE_GAS = teraToGas("100").toString();
// SocialDB keeps any surplus as the writer's storage balance; the deposit is not a fee.
// `storage_balance_bounds.min` on v1.social08.testnet is 0.02 NEAR; 0.05 leaves headroom.
const SOCIALDB_STORAGE_DEPOSIT = "50000000000000000000000";

function transactionHash(value: unknown): string | null {
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
  return null;
}

function toWriteError(value: unknown): Error {
  if (value instanceof Error) return value;
  if (typeof value === "string") return new Error(value);
  try {
    return new Error(JSON.stringify(value));
  } catch {
    return new Error("the wallet returned an unreadable error");
  }
}

/**
 * Sends one `set` call to the SocialDB contract on behalf of the connected wallet.
 * `data` is the account's own subtree; this function nests it under the signer exactly once.
 */
export async function testnetSet(data: Record<string, unknown>, wallet: WalletConnection): Promise<string> {
  if (!wallet.accountId) throw new Error("connect a wallet before writing");

  const settled = await wallet
    .signAndSendTransaction({
      receiverId: nearConfig.socialDbContractId,
      actions: [
        {
          type: "FunctionCall",
          params: {
            methodName: "set",
            args: { data: { [wallet.accountId]: data } },
            gas: SOCIALDB_WRITE_GAS,
            deposit: SOCIALDB_STORAGE_DEPOSIT,
          },
        },
      ],
    })
    .catch((error: unknown) => error);

  const hash = transactionHash(settled);
  if (hash) return hash;
  throw toWriteError(settled);
}

/** SocialDB stores the latest main post as a JSON string plus its index entry. */
export function socialDbPostData(text: string): Record<string, unknown> {
  return {
    post: { main: JSON.stringify({ text, type: "md" }) },
    index: { post: JSON.stringify({ key: "main", value: { type: "md" } }) },
  };
}

export function socialDbFollowData(target: string, on: boolean): Record<string, unknown> {
  return {
    graph: { follow: { [target]: on ? "" : null } },
    index: {
      graph: JSON.stringify({ key: "follow", value: { type: on ? "follow" : "unfollow", accountId: target } }),
    },
  };
}

export function socialDbProfileData(name: string, about: string, avatar: string | null): Record<string, unknown> {
  const profile: Record<string, unknown> = { name, description: about };
  if (avatar) profile.image = { url: avatar };
  return { profile };
}

export type TestnetProfileUpdate = {
  name: string;
  about: string;
  avatar?: string | null;
};

/**
 * Wallet-signed testnet writes. Each wrapper builds the SocialDB `set` payload and sends it
 * through `testnetSet`, which nests the data under the connected account exactly once.
 */
export async function setProfile(wallet: WalletConnection, update: TestnetProfileUpdate): Promise<string> {
  if (!wallet.accountId) throw new Error("connect a wallet before saving a profile");
  const name = update.name.trim();
  const about = update.about.trim();
  if (about.length > 10_000) throw new Error("the bio must be at most 10,000 characters");
  if (name.length > 64) throw new Error("the display name must be at most 64 characters");
  return testnetSet(socialDbProfileData(name, about, update.avatar ?? null), wallet);
}

export async function createPost(wallet: WalletConnection, text: string): Promise<string> {
  const body = text.trim();
  if (body.length === 0) throw new Error("write something before posting");
  if (!wallet.accountId) throw new Error("connect a wallet before posting");
  return testnetSet(socialDbPostData(body), wallet);
}

export async function follow(wallet: WalletConnection, target: string, on: boolean): Promise<string> {
  if (!wallet.accountId) throw new Error("connect a wallet before following");
  const accountId = target.trim().toLowerCase();
  if (accountId.length === 0) throw new Error("a follow needs a target account id");
  if (accountId === wallet.accountId) throw new Error("you cannot follow yourself");
  return testnetSet(socialDbFollowData(accountId, on), wallet);
}

function parseMainPost(raw: unknown): { text: string } | null {
  const main = typeof raw === "string" ? safeJsonParse(raw) : raw;
  if (!main || typeof main !== "object" || !("text" in main)) return null;
  return typeof main.text === "string" ? { text: main.text } : null;
}

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

async function loadMainPost(accountId: string): Promise<{ text: string } | null> {
  const data = await getTestnetSocial().get({ keys: [`${accountId}/post/main`], useApiServer: false });
  const accountData = data?.[accountId];
  if (!accountData || typeof accountData !== "object" || !("post" in accountData)) return null;
  const post = accountData.post;
  if (!post || typeof post !== "object" || !("main" in post)) return null;
  return parseMainPost(post.main);
}

function entryToFeedItem(entry: IndexEntry, text: string): FeedItem {
  const accountId = entry.accountId;
  const blockHeight = entry.blockHeight;
  const post: Post = {
    key: `${accountId}/${blockHeight}`,
    id: String(blockHeight),
    author: { account_id: accountId, name: null, avatar_url: null },
    text,
    created_at: null,
    block_height: blockHeight,
  };
  return { type: "post", post };
}

export async function testnetActivityFeed(limit = 20): Promise<FeedPage<FeedItem>> {
  const entries = await getTestnetSocial().getActivityFeed({ limit });
  const authors = Array.from(new Set(entries.map(entry => entry.accountId)));
  const posts = new Map<string, string>();
  await Promise.all(
    authors.map(async author => {
      const main = await loadMainPost(author);
      if (main) posts.set(author, main.text);
    }),
  );
  const items = entries
    .map(entry => entryToFeedItem(entry, posts.get(entry.accountId) ?? ""))
    .filter(item => item.post.text.length > 0);
  return { items, next_cursor: null };
}

export async function testnetAccountFeed(accountId: string, limit = 20): Promise<FeedPage<FeedItem>> {
  const entries = await getTestnetSocial().getAccountFeed(accountId, { limit });
  if (entries.length === 0) return { items: [], next_cursor: null };
  const main = await loadMainPost(accountId);
  if (!main) return { items: [], next_cursor: null };
  return { items: [entryToFeedItem(entries[0], main.text)], next_cursor: null };
}

export async function testnetAccountProfile(accountId: string): Promise<AccountProfile> {
  const social = getTestnetSocial();
  const [profile, followers, following, feed] = await Promise.all([
    social.getProfile(accountId),
    social.getFollowers(accountId),
    social.getFollowing(accountId),
    social.getAccountFeed(accountId, { limit: 100 }),
  ]);
  const avatarUrl = profile?.image?.url ?? null;
  return {
    accountId,
    hasProfile: profile !== null,
    name: profile?.name ?? null,
    about: profile?.description ?? "",
    avatar: avatarUrl,
    avatarUrl,
    followers: followers.length,
    following: Object.keys(following ?? {}).length,
    posts: feed.length,
  };
}

export async function testnetFollowers(accountId: string): Promise<FeedPage<AccountCard>> {
  const followers = await getTestnetSocial().getFollowers(accountId);
  return {
    items: followers.map(follower => ({ account_id: follower.accountId })),
    next_cursor: null,
  };
}

export async function testnetFollowing(accountId: string): Promise<FeedPage<AccountCard>> {
  const following = await getTestnetSocial().getFollowing(accountId);
  const items = Object.keys(following ?? {}).map(key => {
    const accountIdFromKey = key.includes("/") ? key.slice(key.lastIndexOf("/") + 1) : key;
    return { account_id: accountIdFromKey };
  });
  return { items, next_cursor: null };
}
