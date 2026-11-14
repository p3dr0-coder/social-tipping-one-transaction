/** Pure FastData quota, account-id, and reputation rules. No runtime imports (`node --test` safe). */

export const QUOTAS = {
  postsPerDay: 300,
  maxPostChars: 25_000,
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
const encoder = new TextEncoder();

export function isValidAccountId(accountId: string): boolean {
  return accountId.length >= 2 && accountId.length <= 64 && ACCOUNT_ID_PATTERN.test(accountId);
}

export function isNamedAccountId(accountId: string): boolean {
  return isValidAccountId(accountId) && !/^[0-9a-f]{64}$/.test(accountId);
}

const REPUTATION_TIERS = [
  { minimumFollowers: 1_000, label: "Luminary" },
  { minimumFollowers: 100, label: "Steward" },
  { minimumFollowers: 10, label: "Contributor" },
] as const;

/** Client-derived tier from indexer follower count (no contract state backs it). */
export function reputationFor(followers: number): { label: string; minimumFollowers: number } | null {
  return REPUTATION_TIERS.find(tier => followers >= tier.minimumFollowers) ?? null;
}

function utf8ByteLength(value: string): number {
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) > 0x7f) return encoder.encode(value).byteLength;
  }
  return value.length;
}

export function assertWriteBudget(data: Record<string, unknown>): void {
  const keys = Object.keys(data);
  if (keys.length > QUOTAS.keysPerTx) {
    throw new Error(`a single write carries at most ${QUOTAS.keysPerTx} keys`);
  }
  let txBytes = 2;
  let hasEntry = false;
  for (const key of keys) {
    if (utf8ByteLength(key) > QUOTAS.keyBytes) {
      throw new Error(`key "${key}" exceeds ${QUOTAS.keyBytes} bytes`);
    }
    const valueJson = JSON.stringify(data[key]);
    if (valueJson === undefined) continue;
    const valueBytes = utf8ByteLength(valueJson);
    if (valueBytes > QUOTAS.valueBytes) {
      throw new Error(`the value for "${key}" exceeds ${QUOTAS.valueBytes} bytes`);
    }
    txBytes += (hasEntry ? 1 : 0) + utf8ByteLength(JSON.stringify(key)) + 1 + valueBytes;
    hasEntry = true;
  }
  if (txBytes > QUOTAS.txBytes) {
    throw new Error(`the write is ${txBytes} bytes; a transaction carries at most ${QUOTAS.txBytes}`);
  }
}
