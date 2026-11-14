# SUBMISSION-PREP — philia (LOCAL DRAFT, NOT SUBMITTED)

Track: `social` (spec `p0-social.md`). Deadline 2026-11-14T23:59:00Z.
No push, no remote, no tags, no X post, no submit. Local commit only.

## Judge quickstart (do X → see Y), MEASURED pre-Celesto-only

```
pnpm test                 -> 19/19 pass, EXIT 0
pnpm check-types          -> tsc 7.0.2, EXIT 0
pnpm lint                 -> eslint 10.15.0, 0 warnings / 0 errors
pnpm build                -> Next 16.4.6, 4 routes, EXIT 0 (19.7s)
pnpm peers check          -> "No peer dependency issues found"
WSL cargo test --lib      -> 24/24 pass (6m50s cold; rustc 1.100.0,
                             near-sdk 5.30.2, near-sandbox 0.4.1)
cargo near build          -> wasm 138,431 B
git diff --check          -> EXIT 0; ADDED_SUPPRESSION_MARKERS=0
```

`Map.getOrInsert` engine gate removed: 903 → 48 allocs, 32.5k → 17.6k ns.
FastData real `/v0/multi` K=16: 157 ms / 1 round trip vs serial 2512 ms /
16 round trips, oracle-equal. `date-fns` → native `Intl`.

## Recordable demo outline (human records, human posts)

1. Sign in with a named NEAR account, set a profile, publish a post.
2. Follow another account, tip it through the Rust preference contract.
3. Show the tip preference readback. One moment, visible result.
Q-012 video required when judges cannot open the demo. Tags @NEARProtocol,
#NEARHackathon. Main writes no post.

## Payload fields — ALL EMPTY, human supplies every value

| Field | Rule | Value |
|---|---|---|
| requestId | UUID, generated ONCE, reused on 400/503 | EMPTY |
| projectName | 2-80 chars | EMPTY |
| leadName | 2-80 chars | EMPTY |
| email | valid, <=160, max 2 submissions per address (Q-015) | EMPTY |
| size | `1` / `2 - 4` / `4 - 6` / `6 - 8` / `8+` | EMPTY |
| tracks | >=1 track id, each once; `social` fits | EMPTY |
| nearAddress | 2-64 lowercase mainnet account the team creates | EMPTY |
| projectUrl | http(s), <=300, public repo, unique | EMPTY |
| demoUrl | http(s), <=300, published X post | EMPTY |
| idea | 20-2000 chars | EMPTY |
| consent | `true` only after verbatim notice + human yes | EMPTY |

Never add `website`. Print full JSON, wait for explicit yes. 201 saved;
400 fix `fields` + same requestId; 403 stop; 409 stop; 413 shorten; 503 retry
same requestId.

## Rules checklist

- Q-003: `origin-baseline` tag exists (verified), but no `pre-hackathon` /
  `hackathon-submission` pair and no README diff link. **Not satisfied**;
  local tags deliberately not created.
- Q-012 video required when judges cannot open the demo.
- Q-014 `LICENSE` present. Q-017 README "Quickstart" at line 43 with numbered
  install/config/account/build steps.
- Q-015 second project on same email must be named in README. Unresolved.
- HELD: 1 pre-existing `Avatar.tsx:43` eslint-disable (unchanged), Node 26
  `module.register` deprecation, TS7 `toBase64` typing.

## Blockers (do not block submission)

Celesto `Trial credit is too low to start this sandbox` → clippy/cargo-near/
gas re-verify BLOCKED-BY-CELESTO. Firecrawl daily credits BLOCKED. Exa MCP
402 → direct REST + keenable. BoxLite §6 MEASURED `kkCM4DpkbXU6` (two earlier
nested-quoting 401 failures quoted verbatim, no box leaked).

## Attestation

Nothing published, pushed, tagged, or submitted. No payload value invented.
