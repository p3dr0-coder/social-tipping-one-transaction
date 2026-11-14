import { JsonRpcProvider } from "near-api-js";
import { nearConfig } from "../near.config.ts";

/** Normalizes a wallet, RPC, or thrown value into an Error with a readable message. */
export function toError(value: unknown): Error {
  if (value instanceof Error) return value;
  if (typeof value === "string") return new Error(value);
  try {
    return new Error(JSON.stringify(value));
  } catch {
    return new Error("the wallet returned an unreadable error");
  }
}

/** Resolves after `ms` milliseconds. One shared implementation for every poll loop. */
export function delay(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

let rpcProvider: JsonRpcProvider | null = null;

/** Returns the single shared JSON-RPC provider for the configured network. */
export function getRpcProvider(): JsonRpcProvider {
  if (!rpcProvider) rpcProvider = new JsonRpcProvider({ url: nearConfig.rpcUrl });
  return rpcProvider;
}
