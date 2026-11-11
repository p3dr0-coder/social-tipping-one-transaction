# ATTRIBUTION

## Origin project

- Repository: https://github.com/NikhilRaikwar/SocialENS
- License: MIT (see [`LICENSE`](./LICENSE))
- Original author: SocialENS Team
- Import baseline: the repository as published on its default branch, imported at the start
  of this port and retained as the project's history.

## Reused (adapted for NEAR)

The port keeps the presentation layer of the origin application, because it is chain-agnostic
and already MIT-licensed:

- The Next.js App Router layout and page shells (`app/layout.tsx`, `app/page.tsx`,
  `app/profile/page.tsx`, `app/[name]/page.tsx`, `app/not-found.tsx`) as the starting structure.
- The Tailwind CSS 4 + daisyUI 5 design system, glass panels, gradients, and animations in
  `web/styles/globals.css`.
- `web/components/Header.tsx`, `web/components/Footer.tsx`,
  `web/components/ThemeProvider.tsx`, and `web/components/SwitchTheme.tsx` (rewritten where
  they touched wallet or chain state).
- The toast notification surface (`web/utils/notification.tsx`).
- The social UI composition and markup: compose box, feed cards, follow button, follower
  modal, search dropdown, suggested users, sidebar, landing page, scroll-to-top.
- The public image assets under `web/public/`.

## Rewritten

Everything that depended on the origin chain stack was removed and reimplemented for NEAR:

- Data layer: ENS text records replaced by the near.social social DB
  (`social-kv/1` FastData KV on mainnet and the SocialDB contract on testnet), with cursor
  pagination, live block streaming, and transaction confirmation through the indexer.
- Identity: name resolution replaced by NEAR account IDs; the route parameter is the full
  account ID and the access gate checks for a named (non-implicit) account.
- Wallet: EVM connectors and their hooks replaced by a client-only NEAR Connect provider with
  a function-call access key plugin.
- Payments: ERC-20 transfers replaced by NEP-141 `ft_transfer`, including receiver
  registration through `storage_balance_bounds`, plus an optional 1Click cross-chain quote.
- Media: external avatar URLs replaced by FastFS uploads with a borsh-encoded payload.
- Tip preferences: two inconsistent text records replaced by the `philia-tips` contract with
  storage accounting, refunds, and NEP-297 events.
- Discovery: block-log scanning replaced by the indexer's feed, search, suggestion, follower,
  and stream endpoints.
- Tooling: the unused EVM contract workspace scripts were deleted; the repository now has a
  Rust contract workspace, sandbox tests, deploy scripts, and a Node demo.

## What is not derived from the origin

The `contract/` crate, the `demo/` scripts, the `scripts/` deployment helpers, and every file
under `web/lib/` are new work created for this port.
