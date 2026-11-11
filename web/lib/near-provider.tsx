"use client";

import { JsonRpcProvider } from "near-api-js";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { nearConfig } from "~~/near.config";

export type FunctionCallAction = {
  type: "FunctionCall";
  params: {
    methodName: string;
    args: Record<string, unknown>;
    gas: string;
    deposit: string;
  };
};

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

type ConnectorWallet = {
  getAccounts?: () => Promise<Array<{ accountId: string }>>;
  signAndSendTransaction: (params: SignAndSendTransactionParams) => Promise<unknown>;
};

type ConnectorEvents = {
  "wallet:signIn": { wallet?: ConnectorWallet; accounts?: Array<{ accountId: string }> };
  "wallet:signOut": unknown;
};

type Connector = {
  whenManifestLoaded: Promise<void>;
  connect: () => Promise<ConnectorWallet>;
  disconnect: () => Promise<void>;
  getConnectedWallet?: () => Promise<{ wallet: ConnectorWallet; accounts: Array<{ accountId: string }> }>;
  use: (plugin: unknown) => Promise<void>;
  on: <K extends keyof ConnectorEvents>(event: K, callback: (payload: ConnectorEvents[K]) => void) => void;
  network: "mainnet" | "testnet";
  providers?: { mainnet?: string[]; testnet?: string[] };
};

export type ViewRequest = {
  contractId: string;
  method: string;
  args?: Record<string, unknown>;
};

type NearContextValue = {
  accountId: string | null;
  connector: Connector | null;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  signAndSendTransaction: (params: SignAndSendTransactionParams) => Promise<unknown>;
  viewFunction: (request: ViewRequest) => Promise<unknown>;
};

const NearContext = createContext<NearContextValue | null>(null);

let rpcProvider: JsonRpcProvider | null = null;

function getRpcProvider(): JsonRpcProvider {
  if (!rpcProvider) {
    rpcProvider = new JsonRpcProvider({ url: nearConfig.rpcUrl });
  }
  return rpcProvider;
}

export function NearProvider({ children }: { children: ReactNode }) {
  const [accountId, setAccountId] = useState<string | null>(null);
  const [connector, setConnector] = useState<Connector | null>(null);
  const walletRef = useRef<ConnectorWallet | null>(null);

  useEffect(() => {
    let cancelled = false;

    // The connector touches window, localStorage, and IndexedDB, so it is only ever
    // constructed in the browser after hydration. A static import cannot work here: both
    // modules are browser-only and would be evaluated during server rendering.
    async function initialize() {
      const { NearConnector } = await import("@hot-labs/near-connect");
      const { createAccessKeyPlugin } = await import("function-call-key-plugin");
      const instance = new NearConnector({ network: nearConfig.network }) as unknown as Connector;
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
        const restored = await instance.getConnectedWallet?.();
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
    const accounts = await wallet.getAccounts?.();
    const nextAccount = accounts?.[0]?.accountId;
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
    return wallet.signAndSendTransaction(params);
  }, []);

  const viewFunction = useCallback(async (request: ViewRequest) => {
    const result = await getRpcProvider().callFunction({
      contractId: request.contractId,
      method: request.method,
      args: request.args ?? {},
    });
    if (result === undefined) {
      throw new Error(`${request.method} on ${request.contractId} returned no value`);
    }
    return result;
  }, []);

  const value = useMemo<NearContextValue>(
    () => ({
      accountId,
      connector,
      connect,
      disconnect,
      signAndSendTransaction,
      viewFunction,
    }),
    [accountId, connector, connect, disconnect, signAndSendTransaction, viewFunction],
  );

  return <NearContext.Provider value={value}>{children}</NearContext.Provider>;
}

export function useNear(): NearContextValue {
  const value = useContext(NearContext);
  if (!value) throw new Error("useNear must be used inside NearProvider");
  return value;
}
