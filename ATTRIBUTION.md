# ATTRIBUTION

## Origin project

- Repository: https://github.com/NikhilRaikwar/SocialENS (MIT, [`LICENSE`](./LICENSE)), author SocialENS Team, imported from its default branch and retained in git history.

## Reused (adapted for NEAR)

The port keeps the chain-agnostic, MIT-licensed presentation layer:

- App Router shells (`app/layout.tsx`, `app/page.tsx`, `app/profile/page.tsx`, `app/[name]/page.tsx`, `app/not-found.tsx`).
- Tailwind CSS 4 + daisyUI 5 styles and animations in `web/styles/globals.css`.
- `web/components/Header.tsx`, `web/components/Footer.tsx`, `web/components/ThemeProvider.tsx`, `web/components/SwitchTheme.tsx` (adapted for NEAR state), `web/utils/notification.tsx`, `web/public/`, and the social UI components.

## Rewritten for NEAR

- **Data and discovery:** ENS text records and block scanning are replaced by near.social social DB. It uses `social-kv/1` FastData KV on mainnet and SocialDB on testnet. The port adds cursor pagination, indexer feeds, search, suggestions, follower lists, streaming, and transaction confirmation.
- **Identity and wallet:** Name resolution and EVM connectors are replaced by NEAR named account IDs. The route parameter is the full account ID, and a non-implicit account gates access. Wallets use a client-only NEAR Connect provider with a function-call access key plugin.
- **Payments and media:** ERC-20 transfers are replaced by NEP-141 `ft_transfer`. Receiver registration uses `storage_balance_bounds`, quotes come from 1Click, and avatars upload through FastFS as Borsh.
- **Tip preferences and tooling:** Text records are replaced by `philia-tips`, which adds storage accounting, refunds, and NEP-297 events. EVM workspace scripts are deleted in favor of Rust `contract/`, sandbox tests, `scripts/`, and `demo/`.

## Original port work

`contract/`, `demo/`, `scripts/`, and all files under `web/lib/` are new work created for this port.
