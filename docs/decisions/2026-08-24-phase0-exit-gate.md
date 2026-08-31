# Phase 0 Exit-Gate Report

**Date:** 2026-08-24
**Baseline:** v1.0.4 (commit `e01faae`)
**Current:** v1.1.0 (commit `1bbcf98`)
**ROADMAP reference:** §7 Phase 0 exit criteria

---

## Exit Criterion: "a skeptical stranger can install, run a room with only the agents they actually have, see honest errors for the rest, and find zero untrue statements in README/docs."

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | **Adapter honesty** — silent mock fallbacks killed; missing binary → explicit error | ✅ **PASS** | Codex, Pi, Kilo, Cline + DeclarativePluginAdapter throw `'<Name> binary (<bin>) not found'` when binary missing. Mock only under `AGENTDECK_MOCK_EXECUTION=true` or `NODE_ENV=test`. Regression test proves honest throw. |
| 2 | **Transport badges** — user can see which messages are real vs simulated | ✅ **PASS** | `postMessage` carries `rawPayload` with `{transport, exitCode, tokensTotal, costUSD}`. Web shows amber "SIMULATED" badge for mock; TUI shows `[mock]`. Server messages route strips client-supplied rawPayload (badge-spoof guard). |
| 3 | **Runtime cap enforcement** — `maxRuntimeSec` interrupts running processes, not just checks at turn boundaries | ✅ **PASS** | `executeSingleTurn` now sets `setTimeout(() => abortCtrl.abort(), remaining)` within the turn. Adapter receives abort signal and is terminated via SIGTERM→SIGKILL. Regression test: mock adapter sleeps 5s, cap at 1s, abort received in ~1.1s. |
| 4 | **Room cap CRUD** — `createRoom`/`updateRoom` persist cap settings | ✅ **PASS** | `createRoom` accepts `maxTurnsPerRun`, `maxRuntimeSec`, `maxCostUSD` params (no longer hardcoded). `updateRoom` patches `turn_limit`, `runtime_limit_sec`, `cost_limit_usd`. |
| 5 | **Real cost/token accounting** — no more hardcoded `+150 tokens/+$0.0005` | ✅ **PASS** | Engine uses `execResult.tokensUsed.total.value ?? 0` / `execResult.costUSD.value ?? 0`. Coordinator mode accumulates correctly. |
| 6 | **WebSocket authentication** — `/ws` guarded when `--token` set | ✅ **PASS** | `/ws` endpoint requires `Authorization: Bearer` header or `?token=` query parameter. Timing-safe comparison. Unauthenticated requests rejected. |
| 7 | **`--lan` validation** — refuses to start without `--token` | ✅ **PASS** | `createAgentDeckServer` throws when `allowLan && !authToken`. CLI pre-validates and exits with clear error. |
| 8 | **CORS hardening** — localhost prefix check prevents bypass | ✅ **PASS** | Localhost CORS check uses exact regex matching to prevent `http://localhost.evil.com` bypass. |
| 9 | **Adapter metadata repair** — correct URLs, graceful version lookups | ✅ **PASS** | Hermes install URL corrected. `LatestVersionResult.latestVersion` is `string | null`. `scanAndSync` wraps `getLatestVersion()` in try/catch → null. TTL cache prevents rate limiting. |
| 10 | **GarraIA repositioning** — honest about experimental status | ✅ **PASS** | Description updated to "Author's experimental Rust agent framework." `install()` throws with clear guidance. |
| 11 | **Persistence trio wired** — `orchestration_runs`, `audit_logs`, `backups` tables functional | ✅ **PASS** | Manager methods + REST endpoints (`GET /api/v1/runs`, `GET /api/v1/audit-logs`, `GET /api/v1/backups`) all functional. |
| 12 | **Test infrastructure** — `apps/**` under vitest, no duplicate test dirs | ✅ **PASS** | `vitest.config.ts` includes `apps/**/*.test.ts`. Duplicate `test/` directories removed. 89/89 tests passing. |
| 13 | **CI lint step** — `pnpm lint` runs in CI | ✅ **PASS** | GitHub Actions runs `pnpm lint` in addition to typecheck and tests. Lint passes clean. |
| 14 | **Docs truth** — README/docs claims match code reality | ✅ **PASS** | "real-time WebSocket streaming" fixed → "live event feed and full CRUD operations" (both EN and pt-BR). Phantom `RuntimeSession` entity removed from pt-BR architecture diagram. Cap enforcement docs accurately state "at turn boundaries." |
| 15 | **Build metadata honesty** — no frozen fake dates | ✅ **PASS** | `builtAt` and `environment` use real values. Web Deck version badge uses `WEB_APP_VERSION` instead of hardcoded string. |
| 16 | **GitHub Sponsors** — FUNDING.yml committed | ✅ **PASS** | `.github/FUNDING.yml` committed (`ff8d979`). GitHub Sponsors account activation is external owner action. |
| 17 | **Version bump** — v1.1.0 across all carriers | ✅ **PASS** | 7 carriers updated: `packages/shared/src/version.ts`, 3× `package.json`, `scripts/install.sh` FALLBACK_VERSION, `apps/web/src/version.ts`, `App.tsx` badge. CHANGELOG.md written. Local tag `v1.1.0` created. |
| 18 | **Name selection & reservation** — name chosen, registries reserved | ❌ **BLOCKED BY OWNER** | All 4 shortlisted coined names (agentforge, agentflow, agentmesh, agenthub) are BLOCKED by incumbents/trademarks. Owner must decide: deeper coined names, keep "AgentDeck", or scoped package. Research in `docs/decisions/2026-08-24-rename-research.md`. Deadline: Sep 30, 2026. |
| 19 | **Sponsors account activation** — GitHub Sponsors listing live | ❌ **BLOCKED BY OWNER** | FUNDING.yml committed. Owner must activate Sponsors via GitHub web UI (external action). |

---

## Summary

| Verdict | Count |
|---------|-------|
| ✅ PASS | 17 |
| ❌ BLOCKED BY OWNER | 2 |
| ❌ FAIL | 0 |

**All code/technical exit criteria are satisfied.** The two remaining blockers are owner-side decisions:

1. **Name choice** — every tested `agent*` compound is contested. Owner must pick from alternatives (deeper coined names, keep AgentDeck, scoped package) and reserve same-day.
2. **Sponsors activation** — requires owner to complete GitHub Sponsors onboarding via web UI.

## Build Validation (post-fix)

```
pnpm build     ✅
pnpm typecheck ✅
pnpm lint      ✅
pnpm test      ✅ (89/89 tests)
```

## Commit Chain

| Commit | Description |
|--------|-------------|
| `ff8d979` | FUNDING.yml for GitHub Sponsors |
| (batched) | Adapter honesty + metadata repair + GarraIA reposition |
| (batched) | Core accounting + runtime cap enforcement + CRUD params |
| (batched) | Security triad (WS auth, LAN validation, CORS) |
| (batched) | Test infrastructure + regression tests |
| (batched) | Docs truth pass |
| `1bbcf98` | Release chore (v1.1.0 bump, CHANGELOG, CI lint, build-info) |

## Recommendation

**Phase 0 is functionally complete.** Proceed to Phase 1 (Streaming end-to-end, Task 1.1) while the owner resolves the two blocked items. The name decision has a soft deadline of Sep 30, 2026 and does not gate Phase 1 work — the rename migration (Task 1.8) is scheduled for Week 11.
