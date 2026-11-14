"use client";

import type {
  ConnectorAction,
  NearConnector,
  NearWalletBase,
  SignMessageParams,
  SignedMessage,
} from "@hot-labs/near-connect";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { nearConfig } from "~~/near.config";

export type FunctionCallAction = Extract<ConnectorAction, { type: "FunctionCall" }>;

/**
 * A near-js style function-call action. Borsh payloads (FastFS uploads) cannot be expressed as
 * a JSON object, so those calls use the byte-array action shape instead.
 */
export type ByteFunctionCallAction = {
  functionCall: {
    methodName: string;
    args: Uint8Array;
    gas: bigint;
    deposit: bigint;
  };
};

export type WalletAction = FunctionCallAction | ByteFunctionCallAction;

export type SignAndSendTransactionParams = {
  signerId?: string;
  receiverId: string;
  actions: WalletAction[];
};

export type { SignMessageParams, SignedMessage };

type NearContextValue = {
  accountId: string | null;
  connector: NearConnector | null;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  signAndSendTransaction: (params: SignAndSendTransactionParams) => Promise<unknown>;
  signMessage: (params: SignMessageParams) => Promise<SignedMessage>;
};

const NearContext = createContext<NearContextValue | null>(null);

export function NearProvider({ children }: { children: ReactNode }) {
  const [accountId, setAccountId] = useState<string | null>(null);
  const [connector, setConnector] = useState<NearConnector | null>(null);
  const walletRef = useRef<NearWalletBase | null>(null);

  useEffect(() => {
    let cancelled = false;

    // Browser-only modules (touch window, localStorage, IndexedDB); static value import fails SSR.
    async function initialize() {
      const { NearConnector: ConnectorCtor } = await import("@hot-labs/near-connect");
      const { createAccessKeyPlugin } = await import("function-call-key-plugin");
      // NEP-516 `evm-on-near`: optional manifest registers EVM wallets controlling `0x…` NEAR accounts.
      const instance = new ConnectorCtor({
        network: nearConfig.network,
        ...(nearConfig.evmManifest ? { manifest: nearConfig.evmManifest } : {}),
      });
      await instance.whenManifestLoaded;
      if (cancelled) return;

      const accessKeyPlugin = createAccessKeyPlugin({
        network: instance.network,
        providers: instance.providers,
        signIn: {
          contractId: nearConfig.socialReceiver,
          methodNames: ["__fastdata_kv", "__fastdata_fastfs"],
          allowance: "250000000000000000000000",
        },
      });
      await instance.use(accessKeyPlugin);
      if (cancelled) return;

      instance.on("wallet:signIn", event => {
        if (event.wallet) walletRef.current = event.wallet;
        const nextAccount = event.accounts?.[0]?.accountId;
        if (nextAccount) setAccountId(nextAccount);
      });
      instance.on("wallet:signOut", () => {
        walletRef.current = null;
        setAccountId(null);
      });

      setConnector(instance);

      try {
        const restored = await instance.getConnectedWallet();
        if (!cancelled && restored?.accounts[0]) {
          walletRef.current = restored.wallet;
          setAccountId(restored.accounts[0].accountId);
        }
      } catch {
        // No wallet is connected yet; the user will connect from the header.
      }
    }

    void initialize();

    return () => {
      cancelled = true;
    };
  }, []);

  const connect = useCallback(async () => {
    if (!connector) throw new Error("the wallet connector is still loading");
    await connector.whenManifestLoaded;
    const wallet = await connector.connect();
    walletRef.current = wallet;
    const accounts = await wallet.getAccounts();
    const nextAccount = accounts[0]?.accountId;
    if (nextAccount) setAccountId(nextAccount);
  }, [connector]);

  const disconnect = useCallback(async () => {
    if (!connector) return;
    await connector.disconnect();
    walletRef.current = null;
    setAccountId(null);
  }, [connector]);

  const signAndSendTransaction = useCallback(async (params: SignAndSendTransactionParams) => {
    const wallet = walletRef.current;
    if (!wallet) throw new Error("connect a wallet before signing a transaction");
    type WalletTx = Parameters<NearWalletBase["signAndSendTransaction"]>[0];
    return wallet.signAndSendTransaction(params as unknown as WalletTx);
  }, []);

  const signMessage = useCallback(async (params: SignMessageParams) => {
    const wallet = walletRef.current;
    if (!wallet) throw new Error("connect a wallet before signing a message");
    if (typeof wallet.signMessage !== "function") {
      throw new Error("the connected wallet does not support NEP-413 message signing");
    }
    return wallet.signMessage(params);
  }, []);

  const value = useMemo<NearContextValue>(
    () => ({
      accountId,
      connector,
      connect,
      disconnect,
      signAndSendTransaction,
      signMessage,
    }),
    [accountId, connector, connect, disconnect, signAndSendTransaction, signMessage],
  );

  return <NearContext.Provider value={value}>{children}</NearContext.Provider>;
}

export function useNear(): NearContextValue {
  const value = useContext(NearContext);
  if (!value) throw new Error("useNear must be used inside NearProvider");
  return value;
}
