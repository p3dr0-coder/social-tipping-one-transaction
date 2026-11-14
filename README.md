# philia

Tracks: `social`, `open` · MIT ([LICENSE](./LICENSE)) · Baseline: tag `pre-hackathon` at `c716879` (SocialENS port); `git diff pre-hackathon..hackathon-submission` · Q-015: the second project on the same email is **ekklesia** (agent market, tracks `swarms`, `agents`).

One signed transaction tips anyone on NEAR social: the wallet approves, the web app confirms, and a contract stores the preference while a bound NEP-141 token moves. Creators get paid where their audience already is, with no custody.

```mermaid
sequenceDiagram
    accTitle: philia runtime flow
    accDescr: Wallet signs a tip transaction, the app confirms it, and the contract stores the preference.
    autonumber
    participant U as NEAR Connect wallet
    participant W as philia-web app
    participant S as near.social api2
    participant P as philia-tips contract
    participant F as bound NEP-141 token
    rect rgba(226,238,255,0.20)
    Note over W,S: PHASE 1 — Read social profile
    W->>+S: GET /v1/accounts/{id} and follower pages
    S-->>-W: profile, counts, posts, next cursor
    end
    rect rgba(230,247,235,0.20)
    Note over W,F: PHASE 2 — Build tip intent
    W->>W: guard account id, viewer, and self-tip
    W->>+P: get_tip_token() and get_tip_preference(author)
    P-->>-W: token decimals and stored amount
    W->>W: parse_units(amount, decimals) without floats
    end
    rect rgba(255,244,214,0.20)
    Note over U,W: PHASE 3 — Sign delegate
    W->>U: signAndSendTransaction(storage_deposit) when unregistered
    W->>+U: signAndSendTransaction(ft_transfer, 1 yoctoNEAR)
    U-->>-W: signed outcome or thrown error
    end
    rect rgba(243,232,255,0.20)
    Note over W,F: PHASE 4-5 — Relay and confirm
    W->>W: broadcastTx, extractTxHash (throws when the outcome carries no hash)
    W->>+F: ft_balance_of(author)
    F-->>-W: base units credited to the author
    end
    rect rgba(255,248,225,0.20)
    Note over P,W: PHASE 6-7 — Settle outcome and write receipt
    W->>W: poll /v1/tx/{hash} until indexed, sumOutcomeFees over tokens_burnt
    W->>+P: set_tip_preference(amount) with a storage deposit
    P-->>-W: PreferenceSet event and refund receipt
    end
```

```bash
pnpm install && cp .env.example web/.env.local
bash scripts/create-accounts.sh && bash scripts/deploy.sh
pnpm dev
node demo/social-loop.mjs
pnpm test && (cd contract && cargo test)
```

| Do this | See this | Proves |
|---|---|---|
| `bash scripts/deploy.sh` | `tips.philia.testnet` with `TIP_FT=wrap.testnet` | quickstart |
| `node demo/social-loop.mjs` | post indexed, tip settled on chain | end-to-end tip |
| `pnpm dev` | profile read, tip sent from the UI | user flow |
| `pnpm test`; `cargo test` | 24/24 JS tests, sandbox suite green | tests |
| `node demo/measure-tip.mjs` | 2.39 Tgas / 0.000217 N per tip | cost |
| Limits | mainnet writes spend real funds; tips need `TIP_FT`, `BOB_ACCOUNT`, `PHILIA_CONTRACT` | honest scope |

[ATTRIBUTION.md](./ATTRIBUTION.md) · [LICENSE](./LICENSE)
