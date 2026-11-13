import { nearConfig } from "~~/near.config";
import {
  fastDataKey,
  fastDataLatestUrl,
  fastDataMultiBody,
  fastDataPrefixBody,
  fastDataPrefixUrl,
  type FastDataLatestRequest,
  type FastDataPrefixRequest,
  type FastDataRow,
} from "./fastdata-core";

export type { FastDataRow } from "./fastdata-core";

export type FastDataReadOptions = {
  signal?: AbortSignal;
};

export type FastDataPage = {
  entries: FastDataRow[];
  pageToken: string | null;
};

async function readFastDataJson(response: Response, label: string): Promise<unknown> {
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`${label} failed: HTTP ${response.status}${detail ? ` ${detail}` : ""}`);
  }
  try {
    return await response.json();
  } catch {
    throw new Error(`${label} returned a non-JSON response`);
  }
}

function entriesOf(payload: unknown): FastDataRow[] {
  if (payload === null || typeof payload !== "object" || !("entries" in payload)) return [];
  const entries = (payload as { entries?: unknown }).entries;
  return Array.isArray(entries) ? (entries as FastDataRow[]) : [];
}

/** Reads the latest indexed row for one exact key. */
export async function fetchFastDataLatest(
  request: FastDataLatestRequest,
  options: FastDataReadOptions = {},
): Promise<FastDataRow[]> {
  const url = fastDataLatestUrl(nearConfig.fastDataApiUrl, request);
  const response = await fetch(url, { cache: "no-store", signal: options.signal });
  return entriesOf(await readFastDataJson(response, "FastData latest"));
}

/** Reads a prefix page. The caller passes `pageToken` from the previous page. */
export async function fetchFastDataPrefix(
  request: FastDataPrefixRequest,
  options: FastDataReadOptions = {},
): Promise<FastDataPage> {
  const url = fastDataPrefixUrl(nearConfig.fastDataApiUrl, request);
  const body = fastDataPrefixBody(request);
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
    signal: options.signal,
  });
  const payload = (await readFastDataJson(response, "FastData prefix")) as { page_token?: unknown };
  return {
    entries: entriesOf(payload),
    pageToken: typeof payload.page_token === "string" ? payload.page_token : null,
  };
}

/** Reads up to 100 fully qualified keys in one request. */
export async function fetchFastDataMulti(
  keys: readonly string[],
  includeMetadata = false,
  options: FastDataReadOptions = {},
): Promise<FastDataRow[]> {
  const response = await fetch(`${nearConfig.fastDataApiUrl.replace(/\/+$/, "")}/v0/multi`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(fastDataMultiBody(keys, includeMetadata)),
    cache: "no-store",
    signal: options.signal,
  });
  return entriesOf(await readFastDataJson(response, "FastData multi"));
}

export { fastDataKey };
