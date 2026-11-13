export type NearNetwork = "testnet" | "mainnet";

export const TESTNET_USDC_ACCOUNT = "3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af";
export const MAINNET_USDC_ACCOUNT = "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
export const MAINNET_USDC_ASSET_ID = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";

function readNetwork(): NearNetwork {
  const value = process.env.NEXT_PUBLIC_NEAR_NETWORK ?? "testnet";
  if (value !== "testnet" && value !== "mainnet") {
    throw new Error(`NEXT_PUBLIC_NEAR_NETWORK must be "testnet" or "mainnet", received "${value}"`);
  }
  return value;
}

const network = readNetwork();
const isMainnet = network === "mainnet";

/**
 * Single source of truth for the app's network and contract ids.
 * Everything that talks to NEAR imports this object instead of reading env directly.
 */
export const nearConfig = {
  network,
  rpcUrl:
    process.env.NEXT_PUBLIC_NEAR_RPC_URL ??
    (isMainnet ? "https://free.rpc.fastnear.com" : "https://rpc.testnet.fastnear.com"),
  philiaContract: process.env.NEXT_PUBLIC_PHILIA_CONTRACT ?? "philia.testnet",
  // FastData receiver: the same account id on both networks.
  socialReceiver: process.env.NEXT_PUBLIC_PHILIA_SOCIAL_RECEIVER ?? "social",
  // SocialDB contract id: only the testnet adapter reads and writes through it.
  socialDbContractId:
    process.env.NEXT_PUBLIC_PHILIA_SOCIALDB_CONTRACT_ID ?? (isMainnet ? "social.near" : "v1.social08.testnet"),
  tipFt: process.env.NEXT_PUBLIC_PHILIA_TIP_FT ?? (isMainnet ? MAINNET_USDC_ACCOUNT : TESTNET_USDC_ACCOUNT),
  // Optional NEP-516 `evm-on-near` manifest URL. When set, the connector registers it so
  // MetaMask-controlled `0x…` NEAR accounts can sign in next to native wallets.
  evmManifest: process.env.NEXT_PUBLIC_PHILIA_EVM_MANIFEST,
  socialApiBase: "https://api2.near.social",
  fastDataApiUrl:
    process.env.NEXT_PUBLIC_PHILIA_FASTDATA_API?.trim() ||
    (isMainnet ? "https://kv.main.fastnear.com" : "https://kv.test.fastnear.com"),
  fastfsGateway: "https://main.fastfs.io",
  oneClickQuoteUrl: "https://1click.chaindefuser.com/v0/quote",
  oneClickTokensUrl: "https://1click.chaindefuser.com/v0/tokens",
  mainnetUsdcAssetId: MAINNET_USDC_ASSET_ID,
} as const;
