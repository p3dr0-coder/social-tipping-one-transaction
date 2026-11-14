import { verifyMessage } from "near-api-js/nep413";
import { decodeBase64 as decodeBase64Strict } from "./bytes.ts";
import { getRpcProvider, toError } from "./shared.ts";

/** NEP-413 nonces are exactly 32 random bytes. */
export const AUTH_NONCE_BYTES = 32;

/** The exact payload a NEP-413 signer hashes and signs. */
export type AuthPayload = {
  message: string;
  recipient: string;
  nonce: Uint8Array;
  callbackUrl?: string;
};

/** What a connector wallet returns from `signMessage`; the signature may be base64 or bytes. */
export type WalletSignMessageResult = {
  accountId?: string | null;
  publicKey?: string;
  signature?: string | Uint8Array;
};

/**
 * Minimal wallet surface NEP-413 signing needs. `useNear()` and near-connect wallets both
 * satisfy it; keeping it structural means `auth.ts` never imports the social library.
 */
export type WalletSigner = {
  accountId?: string | null;
  signMessage: (params: {
    message: string;
    recipient: string;
    nonce: Uint8Array;
    callbackUrl?: string;
  }) => Promise<WalletSignMessageResult>;
};

export type SignedAuthMessage = {
  accountId: string;
  publicKey: string;
  signature: Uint8Array;
};

export type CreateAuthPayloadInput = {
  message: string;
  recipient: string;
  callbackUrl?: string;
};

export type VerifyAuthMessageArgs = {
  accountId: string;
  publicKey: string;
  payload: AuthPayload;
  signature: string | Uint8Array;
};


function decodeBase64(value: string): Uint8Array {
  const bytes = decodeBase64Strict(value);
  if (bytes.byteLength === 0) throw new Error("the wallet returned an empty signature");
  return bytes;
}

function assertNonce(nonce: Uint8Array): void {
  if (!(nonce instanceof Uint8Array) || nonce.byteLength !== AUTH_NONCE_BYTES) {
    throw new Error(`a NEP-413 nonce must be ${AUTH_NONCE_BYTES} bytes`);
  }
}

/** 32 cryptographically random bytes for one NEP-413 message. */
export function createAuthNonce(): Uint8Array {
  if (typeof crypto === "undefined" || typeof crypto.getRandomValues !== "function") {
    throw new Error("this runtime has no crypto.getRandomValues, so it cannot mint a NEP-413 nonce");
  }
  return crypto.getRandomValues(new Uint8Array(AUTH_NONCE_BYTES));
}

/**
 * Builds a NEP-413 payload. `recipient` is the app or service the signature is addressed to
 * (a domain or account id); it is part of the signed bytes and must be checked on verification.
 */
export function createAuthPayload(input: CreateAuthPayloadInput): AuthPayload {
  const message = input.message;
  const recipient = input.recipient.trim();
  if (message.length === 0) throw new Error("a NEP-413 message must not be empty");
  if (recipient.length === 0) throw new Error("a NEP-413 recipient must not be empty");
  if (input.callbackUrl !== undefined && input.callbackUrl.length === 0) {
    throw new Error("a NEP-413 callback URL must not be empty when provided");
  }
  return {
    message,
    recipient,
    nonce: createAuthNonce(),
    ...(input.callbackUrl !== undefined ? { callbackUrl: input.callbackUrl } : {}),
  };
}

/**
 * Signs a NEP-413 payload through the connected wallet and normalizes its answer.
 * The signature is returned as raw bytes, ready for `verifyAuthMessage`.
 */
export async function signAuthMessage(wallet: WalletSigner, payload: AuthPayload): Promise<SignedAuthMessage> {
  if (!wallet || typeof wallet.signMessage !== "function") {
    throw new Error("the connected wallet cannot sign NEP-413 messages");
  }
  assertNonce(payload.nonce);

  let result: WalletSignMessageResult;
  try {
    result = await wallet.signMessage({
      message: payload.message,
      recipient: payload.recipient,
      nonce: payload.nonce,
      ...(payload.callbackUrl !== undefined ? { callbackUrl: payload.callbackUrl } : {}),
    });
  } catch (cause) {
    throw new Error(`the wallet refused to sign the NEP-413 message: ${toError(cause).message}`);
  }

  if (!result || typeof result !== "object") {
    throw new Error("the wallet returned no NEP-413 signature");
  }
  const accountId = result.accountId ?? wallet.accountId;
  if (!accountId) throw new Error("the wallet did not report which account signed the NEP-413 message");
  if (typeof result.publicKey !== "string" || result.publicKey.length === 0) {
    throw new Error("the wallet did not report the public key that signed the NEP-413 message");
  }
  if (result.signature === undefined || result.signature === null) {
    throw new Error("the wallet did not return a NEP-413 signature");
  }
  const signature =
    typeof result.signature === "string" ? decodeBase64(result.signature) : new Uint8Array(result.signature);
  if (signature.byteLength === 0) throw new Error("the wallet returned an empty NEP-413 signature");

  return { accountId, publicKey: result.publicKey, signature };
}

/**
 * Verifies a NEP-413 signature with `near-api-js/nep413` against the chain.
 * The signing key must have FullAccess permission on `accountId`; the call throws otherwise.
 * Callers must also compare `payload.recipient` with their own and enforce nonce freshness.
 */
export async function verifyAuthMessage(args: VerifyAuthMessageArgs): Promise<void> {
  if (!args.accountId) throw new Error("NEP-413 verification needs the signing account id");
  if (!args.publicKey) throw new Error("NEP-413 verification needs the signing public key");
  assertNonce(args.payload.nonce);

  const signature = typeof args.signature === "string" ? decodeBase64(args.signature) : args.signature;
  if (!(signature instanceof Uint8Array) || signature.byteLength === 0) {
    throw new Error("NEP-413 verification needs the raw signature bytes");
  }

  try {
    await verifyMessage({
      signerAccountId: args.accountId,
      signerPublicKey: args.publicKey,
      payload: {
        message: args.payload.message,
        recipient: args.payload.recipient,
        nonce: args.payload.nonce,
        ...(args.payload.callbackUrl !== undefined ? { callbackUrl: args.payload.callbackUrl } : {}),
      },
      signature,
      provider: getRpcProvider(),
    });
  } catch (cause) {
    throw new Error(`NEP-413 verification failed for ${args.accountId}: ${toError(cause).message}`);
  }
}
