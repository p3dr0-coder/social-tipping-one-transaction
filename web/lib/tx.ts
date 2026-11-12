/**
 * Extracts the transaction hash from a near-js/connector result or thrown outcome.
 *
 * `social` has no contract code, so callers often receive a `CodeDoesNotExist` error instead
 * of a result; the hash still sits in one of these fields. This is the single extractor used
 * by the mainnet and testnet social paths.
 */
export function extractTxHash(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  // RPC/wallet boundary: the value is an untyped final-execution outcome or error.
  const record = value as Record<string, unknown>;

  const transaction = record.transaction;
  if (transaction && typeof transaction === "object" && "hash" in transaction) {
    const hash = transaction.hash;
    if (typeof hash === "string" && hash.length > 0) return hash;
  }

  const outcome = record.transaction_outcome;
  if (outcome && typeof outcome === "object" && "id" in outcome) {
    const id = outcome.id;
    if (typeof id === "string" && id.length > 0) return id;
  }

  const context = record.context;
  if (context && typeof context === "object" && "transactionHash" in context) {
    const hash = context.transactionHash;
    if (typeof hash === "string" && hash.length > 0) return hash;
  }

  for (const nested of [record.transactionResult, record.result]) {
    if (nested && typeof nested === "object") {
      const hash = extractTxHash(nested);
      if (hash) return hash;
    }
  }

  return null;
}
