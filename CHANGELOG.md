# Changelog

All notable changes to AgentDeck will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **LLM routing** (PR #15): curated provider catalog (`packages/core/src/provider-catalog.ts`), `RoutingService` with two-phase apply, config backup and rollback (`packages/core/src/routing-service.ts`), per-provider secret store (`packages/security/src/secret-store.ts`), and the `LlmConfigurable` adapter contract with merge-based config writing that preserves user settings (`packages/adapter-sdk`). Implemented by the Claude Code, Hermes, OpenClaw, and GarraIA adapters.
- **Agent CLI**: `agentdeck agents setup|status|rollback|link` and `agentdeck mcp-server` (agent-to-agent interop over MCP + Rooms, guarded by rate limiting and cycle detection in `packages/core/src/interop-guardrails.ts`).
- **Web Deck**: Agent Control page (install status, primary/backup routing, API keys, apply/dry-run) and Groups builder page.
- **REST**: `GET /api/v1/agents/llm`, `GET|PUT /api/v1/llm-routing`, `POST /api/v1/llm-routing/apply`, `GET|PUT /api/v1/instances/:id/llm-override`, `GET /api/v1/secrets/status`, `PUT /api/v1/secrets/:provider`, `POST /api/v1/providers/test`, `GET /api/v1/providers/catalog`, `POST /api/v1/agents/:id/install`.
- **Database**: migration v3 adds the `llm_routing` table and `agent_instances.llm_override_json`.
- **CI**: Gitleaks scans the full history (`fetch-depth: 0`); `.gitleaks.toml` allowlists the fake-credential test fixtures.

### Changed
- **GarraIA installer**: `install()` now runs the official installer (`https://garraia.org/install.sh`, prebuilt release asset with `.sha256` verification) instead of throwing. Supersedes the 1.1.0 "GarraIA repositioning" note; the experimental/dogfooding description stays.
- **Hermes installer**: `install()` now runs the official NousResearch installer (`https://hermes-agent.nousresearch.com/install.sh`) instead of `git clone`. Supersedes the 1.1.0 "Hermes install URL" note.
- **Web Deck**: the new Agent Control and Groups pages use `apiFetch` (HTTP error detection + safe JSON parsing) like the rest of the app.

## [1.1.0] - 2026-08-24

### Added
- **Transport badges**: Messages now carry raw payload metadata (transport type, exit code, tokens, cost) visible in Web Deck and TUI.
- **Real cost/token accounting**: Orchestration engine now uses actual adapter-reported usage instead of hardcoded estimates.
- **Runtime cap enforcement**: `maxRuntimeSec` room setting is now enforced both at turn boundaries AND within turn execution — the adapter's abort signal fires when the remaining runtime budget is exhausted, interrupting long-running processes. `maxCostUSD` is enforced at turn boundaries.
- **Room cap creation**: `createRoom` now accepts `maxTurnsPerRun`, `maxRuntimeSec`, and `maxCostUSD` parameters (previously hardcoded to 10/600/null).
- **Persistence trio**: `orchestration_runs`, `audit_logs`, and `backups` tables are now wired with manager methods and REST endpoints (`GET /api/v1/runs`, `GET /api/v1/audit-logs`, `GET /api/v1/backups`).
- **WebSocket authentication**: `/ws` endpoint now requires authentication via `Authorization: Bearer` header or `?token=` query parameter when `--token` is set.
- **CORS hardening**: Localhost CORS check now uses exact regex matching to prevent `http://localhost.evil.com` bypass.
- **`--lan` validation**: `agentdeck web --lan` now requires `--token` and exits with a clear error if missing.
- **TTL cache for version lookups**: `GET /api/v1/agents` now caches adapter version checks for 1 hour to avoid rate limiting.
- **CI lint step**: GitHub Actions now runs `pnpm lint` in addition to typecheck and tests.

### Fixed
- **Adapter honesty**: Codex, Pi, Kilo, Cline, and DeclarativePluginAdapter now throw explicit errors when binary is missing instead of silently fabricating responses. Mock responses only occur under `AGENTDECK_MOCK_EXECUTION=true` or `NODE_ENV=test`.
- **GarraIA repositioning**: Description updated to reflect experimental/dogfooding status; `install()` now throws with clear guidance instead of running broken `cargo install --path .`.
- **Hermes install URL**: Corrected to `https://github.com/NousResearch/hermes-agent.git`.
- **npm package names**: Pi adapter now references `@mariozechner/pi-coding-agent`, Cline references `cline`.
- **Version lookups**: `LatestVersionResult.latestVersion` is now `string | null` with graceful fallback on lookup failure.
- **Build metadata**: `builtAt` and `environment` now use real values instead of frozen fake dates.
- **Web Deck version badge**: Hardcoded "Active v1.0.4" now uses `WEB_APP_VERSION`.
- **TUI navigation**: Extracted into testable `navigation.ts` module with proper imports.

### Changed
- **Room caps CRUD**: `createRoom` and `updateRoom` now properly persist `turn_limit`, `runtime_limit_sec`, and `cost_limit_usd` settings.
- **Test infrastructure**: Added `apps/**/*.test.ts` to vitest glob; deduplicated test directories; rewrote version-consistency test to derive from `AGENTDECK_VERSION`.

## [1.0.4] - 2026-08-21

### Added
- Deterministic routing engine with typed delivery traces.
- Web Deck CRUD operations.
- Static root correctness tests.

## [1.0.3] - 2026-08-20

### Added
- Real agent transports for all adapters.

## [1.0.2] - 2026-08-19

### Fixed
- TUI navigation focus.
- Multiline argument security.
- Setup persona persistence.
