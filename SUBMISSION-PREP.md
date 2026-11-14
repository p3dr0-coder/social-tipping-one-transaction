# SUBMISSION-PREP — philia (LOCAL DRAFT, NOT SUBMITTED)
Tracks: `social`, `open`. Deadline 2026-11-14T23:59:00Z. No push, no remote, no tags, no X post, no submit. Local commit only.

## Judge quickstart (do X → see Y), MEASURED on Celesto Box B
```
pnpm test                     -> 24/24 pass, EXIT 0
pnpm check-types               -> tsc 7.0.2, EXIT 0
pnpm lint                      -> eslint 10.15.0, 0 warnings / 0 errors
pnpm build                     -> Next 16.4.6, 4 routes, EXIT 0
pnpm peers check               -> "No peer dependency issues found"
cargo test --lib               -> 24/24 pass (rustc 1.100.0, near-sdk 5.30.2)
cargo test --test test_basics  -> 2/2 pass (near-sandbox 0.4.1)
cargo near build               -> wasm 124,602 B
git diff --check               -> EXIT 0; ADDED_SUPPRESSION_MARKERS=0
```
`Map.getOrInsert` engine gate removed: 903 → 48 allocs, 32.5k → 17.6k ns. FastData real `/v0/multi` K=16: 157 ms for 1 round trip. Serial takes 2512 ms for 16 round trips, oracle-equal. `date-fns` → native `Intl`.
## Recordable demo outline (human records, human posts)
1. Sign in with a named NEAR account, set a profile, publish a post.
2. Follow another account, tip it through the Rust preference contract.
3. Show the tip preference readback. One moment, visible result.
Q-012 video required when judges cannot open the demo. Tags @NEARProtocol, #NEARHackathon. Main writes no post.

## Payload fields — ALL EMPTY, human supplies every value
| Field | Rule | Value |
|---|---|---|
| requestId | UUID, generated ONCE, reused on 400/503 | EMPTY |
| projectName | 2-80 chars | EMPTY |
| leadName | 2-80 chars | EMPTY |
| email | valid, <=160, max 2 submissions per address (Q-015) | EMPTY |
| size | `1` / `2 - 4` / `4 - 6` / `6 - 8` / `8+` | EMPTY |
| tracks | >=1 track id, each once; `social`, `open` fit | EMPTY |
| nearAddress | 2-64 lowercase mainnet account the team creates | EMPTY |
| projectUrl | http(s), <=300, public repo, unique | EMPTY |
| demoUrl | http(s), <=300, published X post | EMPTY |
| idea | 20-2000 chars | EMPTY |
| consent | `true` only after verbatim notice + human yes | EMPTY |

Never add `website`. Print full JSON, wait for explicit yes. 201 saved. 400 fix `fields` + same requestId. 403 stop. 409 stop. 413 shorten. 503 retry same requestId.

## Rules checklist
- Q-003: `origin-baseline` tag exists (verified), but no `pre-hackathon` / `hackathon-submission` pair and no README diff link. **Not satisfied**, so local tags were deliberately not created.
- Q-012 video required when judges cannot open the demo.
- Q-014 `LICENSE` present. Q-017 README "Quickstart" at line 80 with numbered install/config/account/build steps.
- Q-015 second project on same email must be named in README. Unresolved.
- HELD: 0 suppression markers (`Avatar.tsx` now uses `next/image`), Node 26 `module.register` deprecation, TS7 `toBase64` typing.

## Blockers (do not block submission)
No Box B gate is blocked. The earlier `Trial credit is too low` limit is gone. `cargo clippy --all-targets`, `cargo near build`, and both test suites ran. Firecrawl and Exa MCP credits were limited in W3. Exa direct REST and keenable replaced them. BoxLite §6 MEASURED `kkCM4DpkbXU6`.

## Attestation
Nothing published, pushed, tagged, or submitted. No payload value invented.
