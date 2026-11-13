/** FastData request builders. No runtime imports, so node can test them directly. */

export const FASTDATA_MAX_MULTI_KEYS = 100;
export const FASTDATA_MAX_PREFIX_LIMIT = 200;

export type FastDataRow = {
  current_account_id?: string;
  predecessor_id?: string;
  key: string;
  value: unknown;
  block_height?: number;
  block_timestamp?: number;
  tx_hash?: string;
};

export type FastDataLatestRequest = {
  currentAccountId: string;
  predecessorId: string;
  key: string;
  includeMetadata?: boolean;
};

export type FastDataPrefixRequest = {
  currentAccountId: string;
  predecessorId?: string;
  keyPrefix: string;
  limit?: number;
  pageToken?: string;
  includeMetadata?: boolean;
};

function trimBase(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  if (trimmed.length === 0) throw new Error("a FastData API base URL is required");
  return trimmed;
}

function assertName(value: string, field: string): void {
  if (value.trim().length === 0) throw new Error(`${field} must not be empty`);
}

/** Fully qualified FastData key: `current_account_id/predecessor_id/key`. */
export function fastDataKey(currentAccountId: string, predecessorId: string, key: string): string {
  assertName(currentAccountId, "current account id");
  assertName(predecessorId, "predecessor id");
  assertName(key, "FastData key");
  return `${currentAccountId}/${predecessorId}/${key}`;
}

export function fastDataLatestUrl(baseUrl: string, request: FastDataLatestRequest): string {
  assertName(request.currentAccountId, "current account id");
  assertName(request.predecessorId, "predecessor id");
  assertName(request.key, "FastData key");
  const base = trimBase(baseUrl);
  const path = [
    "v0",
    "latest",
    encodeURIComponent(request.currentAccountId),
    encodeURIComponent(request.predecessorId),
    encodeURIComponent(request.key),
  ].join("/");
  return `${base}/${path}${request.includeMetadata ? "?include_metadata=true" : ""}`;
}

export function fastDataPrefixUrl(baseUrl: string, request: FastDataPrefixRequest): string {
  assertName(request.currentAccountId, "current account id");
  assertName(request.keyPrefix, "FastData key prefix");
  if (request.predecessorId !== undefined) assertName(request.predecessorId, "predecessor id");
  const base = trimBase(baseUrl);
  const path = ["v0", "latest", encodeURIComponent(request.currentAccountId)];
  if (request.predecessorId !== undefined) path.push(encodeURIComponent(request.predecessorId));
  return `${base}/${path.join("/")}`;
}

export function fastDataPrefixBody(request: FastDataPrefixRequest): Record<string, unknown> {
  const limit = request.limit ?? 50;
  if (!Number.isInteger(limit) || limit < 1 || limit > FASTDATA_MAX_PREFIX_LIMIT) {
    throw new Error(`FastData prefix limit must be 1-${FASTDATA_MAX_PREFIX_LIMIT}, received ${String(limit)}`);
  }
  return {
    key_prefix: request.keyPrefix,
    limit,
    ...(request.pageToken !== undefined ? { page_token: request.pageToken } : {}),
    ...(request.includeMetadata ? { include_metadata: true } : {}),
  };
}

export function fastDataMultiBody(keys: readonly string[], includeMetadata = false): Record<string, unknown> {
  if (keys.length === 0) throw new Error("FastData multi needs at least one key");
  if (keys.length > FASTDATA_MAX_MULTI_KEYS) {
    throw new Error(`FastData multi accepts at most ${FASTDATA_MAX_MULTI_KEYS} keys, received ${keys.length}`);
  }
  for (const key of keys) {
    const parts = key.split("/");
    if (parts.length < 3 || parts[0].length === 0 || parts[1].length === 0 || parts.slice(2).join("/").length === 0) {
      throw new Error(`"${key}" is not a fully qualified FastData key: current_account_id/predecessor_id/key`);
    }
  }
  return { keys: [...keys], ...(includeMetadata ? { include_metadata: true } : {}) };
}
