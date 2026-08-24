# AgentDeck Roadmap

**Baseline:** v1.0.4 (commit `e01faae`) · **Written:** 2026-08-24 · **Owner:** Michel (michelbr84), solo maintainer
**Method:** repository audit + live market research (all external figures retrieved 2026-08-24) + owner discovery interview (2 rounds, 8 questions, 2026-08-24).
**Evidence tags:** `[FACT]` verified (source cited) · `[ESTIMATE]` derived by stated arithmetic · `[ASSUMPTION]` unverified premise with a verify-path · `[UNKNOWN]` needed but not yet obtainable.

> This document contains business planning, not legal, tax, or financial advice. Entity, tax, and licensing questions should go to a qualified professional before money changes hands.

---

## Table of contents

1. [North star](#1-north-star)
2. [Where the project actually stands](#2-where-the-project-actually-stands)
3. [Market landscape](#3-market-landscape) (existing solutions, comparison, recommended approach)
4. [Strategy: positioning and moat](#4-strategy-positioning-and-moat)
5. [The name problem](#5-the-name-problem)
6. [Monetization plan](#6-monetization-plan) (model scorecard, pricing, unit economics, gates)
7. [Phased roadmap](#7-phased-roadmap) (Phase 0 → Phase 5, dated)
8. [Metrics and KPIs](#8-metrics-and-kpis)
9. [Risks and mitigations](#9-risks-and-mitigations)
10. [Next 30 days](#10-next-30-days)
11. [Assumption register](#11-assumption-register)
12. [Sources](#12-sources)

---

## 1. North star

From the owner interview `[FACT — owner answers, 2026-08-24]`:

- **Goal:** a sustainable open-source business — adoption, reputation, and product quality first; meaningful income later, potentially salary-replacing. Never short-term revenue at the product's expense.
- **License posture:** open-core. The local core stays MIT and free forever; cloud, collaboration, enterprise, and managed-operations features may be paid.
- **Hosted service:** acceptable only if highly automated, self-service, and low-maintenance per customer.
- **Market:** US/EU developers. Buyer path: individual developers now → teams later.
- **Capacity:** 10–15 h/week of founder time, heavily leveraged with autonomous AI agents for development, testing, research, and docs. The roadmap below assumes that leverage.
- **90-day product focus (owner's pick):** ① Truth & security, ② Group-chat depth.
- **Name:** rename before further distribution, but only after validating a distinctive name across GitHub, npm, domains, registries, search, and trademarks. "AgentDeck" remains the codename/legacy alias during migration.

**One-sentence direction:** become the *actively maintained, vendor-neutral, local-first control deck* where developers manage the lifecycle of every coding agent on their machine and put those agents into real cross-vendor collaboration — with a thin, automated cloud overlay as the eventual paid layer.

---

## 2. Where the project actually stands

A full code audit was performed on 2026-08-24 (all references are `[FACT]` with file:line evidence). Summary: **a fast-built, well-typed skeleton with a genuine SQLite/Fastify/Ink/React spine and a thin, partly-simulated execution layer.** 15 commits over 3 days, ~13.3k lines of TS/TSX, 1 author.

### Genuine assets (build on these)

| Asset | Evidence |
|---|---|
| **Deterministic routing engine with typed delivery traces** — 12 reason codes + actionable hints on every routing decision; no LLM in the routing path | `packages/core/src/orchestration-engine.ts:48-248`, `packages/protocol/src/index.ts:213-238` |
| **Transactional upgrade engine** — plan → backup snapshot → upgrade → level-2 health check → rollback on failure; real `--dry-run` | `packages/core/src/upgrade-engine.ts` (5-step transaction, `:140-168`) |
| **Security-hardened command executor** — `shell:false`, three-tier argument validation, SIGTERM→SIGKILL escalation, streaming callbacks | `packages/adapter-sdk` (`executeSafeCommand`) |
| **8-layer prompt composition with provenance inspector** | `POST /api/v1/inspect-prompt`, docs/prompt-composition.md |
| **Real streaming CLI transports for 4 agents** (claude-code, hermes, openclaw, garraia) with honest binary-missing errors | `packages/adapters/src/claude-code-adapter.ts:362` et al. |
| **Solid CI for the size** — gitleaks, shellcheck, build, typecheck, test | `.github/workflows/ci.yml` |

### Credibility gaps (the audit's P0/P1 list — these are Phase 0/1 work)

1. **Silent mock fallback:** codex/pi/kilo/cline adapters **fabricate plausible responses with fabricated costs** when the binary is missing, invisible in every UI (`codex-adapter.ts:295`, `pi-adapter.ts:309`, `kilo-adapter.ts:309`, `cline-adapter.ts:309`, `plugin-loader.ts:217-229`). A demo where four fake agents chat confidently is a credibility bomb. **P0.**
2. **No user-visible streaming:** no `run:chunk` emitter exists in production code; the Web Deck opens no WebSocket at all — chat is a blocking POST + refetch (`apps/web/src/App.tsx:231-240`). The README's "real-time WebSocket streaming" is currently untrue. **P0.**
3. **Security claims vs reality:** `/ws` is unauthenticated even with `--token` set (`packages/server/src/index.ts:156-166`); `--lan` without `--token` is fully open with permissive CORS; the Web Deck sends no `Authorization` header, so `--token` breaks the browser UI entirely. **P0.**
4. **Decorative guardrails:** `maxCostUSD` and `maxRuntimeSec` are stored and never enforced; token/cost accounting hardcodes `+150 tokens / +$0.0005` per turn while discarding real adapter metrics (`orchestration-engine.ts:355-356`). **P0** for a product whose pitch is "orchestrate expensive agents safely."
5. **Hollow headline modes:** coordinator runs exactly one turn on one agent and never delegates (`orchestration-engine.ts:411`); debate has no proposer/critique/synthesis roles; panel is sequential, not parallel. **P1.**
6. **Dead schema:** `orchestration_runs`, `audit_logs`, `backups` tables have zero reads/writes — no run history, no audit trail, no restorable backup index despite docs claims. **P1.**
7. **Plugin ecosystem is a fork requirement:** no Tier-2 (programmatic) plugin loader, no `manifest.yaml` support, declarative plugins reject ordinary Markdown prompts and cannot stream. **P1 — this is the intended moat and it is the thinnest layer.**
8. **Adapter metadata rot:** hermes `install()` clones the nonexistent `github.com/hermes/hermes-agent.git` (real repo: `NousResearch/hermes-agent` `[FACT — github.com/NousResearch/hermes-agent, retrieved 2026-08-24]`); hermes/openclaw/garraia `getLatestVersion()` return frozen constants, so upgrade checks permanently misfire.
9. **Test blind spot:** `vitest.config.ts` excludes `apps/**` — ~2,700 lines including the entire Web Deck and TUI are untested; all adapter `execute()` tests run the mock path only.
10. **CRUD holes users hit in 10 minutes:** `edit` ignores its target and re-runs setup; rooms can never be deleted; room mode can't change after creation.

### Traction and economics baseline

- Users/installs/stars: `[ASSUMPTION]` ≈ 0 — the repo is 4 days old; owner provided no numbers. Verify: GitHub insights, install.sh download counts.
- Running cost: `[ASSUMPTION]` ≈ $0/month (local-first, no deployed infra — scanner found no deploy config). Revenue: $0.
- Legal entity: `[UNKNOWN]` — owner did not answer. Default assumption: individual, no entity yet; a merchant-of-record (Paddle/Lemon Squeezy) becomes the default rail when paid tiers arrive. Verify before any checkout ships.
- **Monetization readiness verdict: not monetizable yet** — no identity, no entitlements, no billing surface, and (correctly, per strategy) no reason to build them until the adoption gates in §6 are hit.

---

## 3. Market landscape

Checked GitHub, npm, PyPI, Homebrew analytics, Hacker News (Algolia), Reddit stats, and 20+ live pricing pages before planning. All figures retrieved 2026-08-24; star counts and prices drift — re-verify before quoting externally.

### Existing solutions found

**The space is crowded; multi-vendor session supervision is table stakes.** 18+ relevant projects verified. The load-bearing facts:

- **The three biggest OSS agent-manager GUIs of 2025 are dead or pivoted** `[FACT]`: Vibe Kanban (27,904★, company shut down Apr 2026, last push 2026-04-24, residual 1,444 npm downloads/week), Claudia/opcode (22,388★, dormant since 2025-10-16), Crystal (3,109★, pivoted to commercial Nimbalyst). Huge proven demand, **no actively maintained open-source successor** — that vacancy is AgentDeck's opening.
- **Active OSS competitors:** oh-my-claudecode (38,771★ but Claude-only), paseo (14,876★, non-OSI license), Superset (13,287★, non-OSI), Agent Orchestrator (9,917★, Apache-2.0, desktop IDE), Omnigent (9,220★, Apache-2.0 — *closest threat to the group-chat differentiator*: mixes vendor agents in one session with cross-agent review), Claude Squad (8,360★, AGPL), agent-of-empires (3,127★, MIT, TUI+Web, 2026-born), ccmanager (1,226★, MIT, Ink/TypeScript — closest technical sibling), Happy (23,488★, MIT, mobile remote control — proof that remote access is heavily demanded).
- **Commercial niche players** (charging to manage agents you already pay for): Omnara $9/mo unlimited (free ≤10 sessions/mo), AIDEN $19/mo, Nimbalyst Teams $20/user/mo (free in beta), Conductor Pro $50/mo / Teams $60/user/mo (premium justified by cloud workspaces + multiplayer), Sculptor still free in beta.
- **Cautionary corpses** `[FACT]`: Terragon Labs — the best-known cloud orchestrator of Claude Code/Codex — shut down 2026-01-16 and open-sourced its code; Vibe Kanban killed its paid cloud plans in April 2026; CrewAI launched and killed a $25/mo prosumer tier within ~6 months, retreating to free + enterprise-custom. **Standalone hosted orchestration of BYO agents has repeatedly failed as a business.**
- **Platform encroachment:** Anthropic's Claude Managed Agents (public beta reported Apr 2026) moves the vendor up-stack; Omnara now markets itself as "the open-source alternative to Claude Managed Agents."

### Comparison (the closest eight)

| Project | Stars (2026-08-24) | License | Active? | Multi-vendor | Agent↔agent chat | Lifecycle mgmt (detect/config/upgrade) | Web + TUI |
|---|---:|---|---|---|---|---|---|
| oh-my-claudecode | 38,771 | MIT | ✅ | ❌ Claude-only | ✅ (teams) | ❌ | ❌ |
| Vibe Kanban | 27,904 | Apache-2.0 | ❌ dead Apr 2026 | ✅ | ❌ | ❌ | web only |
| paseo | 14,876 | non-OSI | ✅ | ✅ | ❌ | ❌ | ✅ +mobile |
| Agent Orchestrator | 9,917 | Apache-2.0 | ✅ | ✅ | ❌ (hierarchical) | ❌ | desktop |
| Omnigent | 9,220 | Apache-2.0 | ✅ | ✅ | ⚠️ cross-review | ❌ | multi-client |
| Claude Squad | 8,360 | AGPL-3.0 | ✅ | ✅ | ❌ | ❌ | TUI only |
| agent-of-empires | 3,127 | MIT | ✅ | ✅ | ❌ | ❌ | ✅ |
| **AgentDeck (this repo)** | ~0 | **MIT** | ✅ | ✅ | **✅ 4 room modes** | **✅ unique** | ✅ |

**No surveyed project combines agent lifecycle management with inter-agent collaboration rooms.** That intersection — plus non-destructive config overlays and transactional upgrades — is the defensible feature set. It must, however, become *true* (see §2 gaps) before it is marketed.

### Recommended approach (reuse ladder verdict)

The project exists; the build-vs-reuse question applies to its *components*:

1. **Adopt ACP (Agent Client Protocol) as the primary agent transport** — strategy "compose," not "build." ACP is Zed's JSON-RPC-over-stdio "LSP for agents": native in Zed 1.0 and JetBrains IDEs, public registry with 50+ agents including Claude Code, Gemini CLI, Codex, Copilot, and Goose `[FACT — agentclientprotocol.com; zed.dev/blog/acp-progress-report, retrieved 2026-08-24]`. **One generic ACP client adapter buys most of the ecosystem**; bespoke headless-flag adapters (`claude -p`, `codex exec`, `gemini -p`, `opencode run`, `goose run -t`, `openhands --headless --json`, `cline --no-interactive`) remain as fallbacks. Hand-writing an adapter per agent does not scale against 15+ serious CLIs.
2. **Treat AGENTS.md as the canonical overlay target** (60k+ repos, 28+ tools read it natively, now stewarded by the Agentic AI Foundation `[FACT — agents.md; codersera.com, retrieved 2026-08-24]`): write once, mirror to CLAUDE.md and friends for holdouts.
3. **Expose AgentDeck itself as an MCP server** so any agent can query the deck/rooms — MCP connects agents to tools (orthogonal to driving agents), and its new Tasks primitive (spec 2026-07-28) is worth tracking for long-running orchestration.
4. **Do not copy code from AGPL competitors** (Claude Squad, opcode, claudecodeui) into this MIT codebase. MIT-licensed ccmanager and Crystal are legally safe *pattern* references.
5. **Skip A2A for now** — enterprise/cloud-oriented, no local coding CLI speaks it; revisit as a federation bridge in 2028.

### Proposed implementation

The phased roadmap in §7 is the implementation of this recommendation. Sources for every external claim: §12.

---

## 4. Strategy: positioning and moat

**Positioning statement:** *"The maintained, vendor-neutral deck for your coding agents — detect, configure, upgrade, and put them in a room together. Local-first, MIT, your keys, your machine."*

Four pillars, each mapped to evidence:

1. **Vendor-neutral where the giants can't be.** Anthropic, OpenAI, Google, and GitHub each ship their own agent and their own manager; none will ever manage the others well. The npm demand base is enormous and multi-vendor: @anthropic-ai/claude-code 22.6M and @openai/codex 16.1M weekly downloads `[FACT — api.npmjs.org, week 2026-08-17..23]`.
2. **The maintained successor.** The category's three biggest OSS tools died in 2025–2026 with 50k+ combined stars of orphaned demand. Explicitly position against that: comparison docs, migration notes, AlternativeTo listings.
3. **Lifecycle × collaboration intersection** (unique per §3 comparison) — but only after Phase 0/1 makes the claims true.
4. **Local-first as the survivor pattern.** Every failed business in this niche (Terragon, Vibe Kanban cloud) tried to host orchestration; every surviving one keeps local free and charges for remote/team overlay. The moat for an MIT codebase is **not the code** — it is maintenance velocity, community, and (later) the hosted data/team layer. n8n's retroactive license change is not available to us and not desirable `[FACT — n8n Sustainable Use License history, retrieved 2026-08-24]`.

**Explicit non-goals (for focus):** no kanban/task-board clone (Vibe Kanban's ground), no IDE (Superset/AO's ground), no bundled inference resale (Warp's ground, requires VC), no human-to-human messaging platform (vision-doc Q14 — deferred indefinitely), no enterprise sales motion before 2028.

---

## 5. The name problem

`[FACT — all retrieved 2026-08-24]`:

- npm **`agentdeck` is taken** (mccarthysean's dormant mobile-control tool, last publish 2026-02-20, 8 downloads/week). `npx agentdeck` can never be ours.
- GitHub **`agent-deck` (asheshgoplani)** is an active, near-identical competitor: Go TUI for Claude/Gemini/OpenCode/Codex, 784★, pushed 2026-08-24, Homebrew tap, Discord. The hyphenated npm name is free but would collide head-on with them.
- At least two more "AgentDeck" projects launched on HN in 2026 (agentdeck.site Mac app; github.com/agentdeck/agentdeck game console). We would be the *fifth* entrant into this name and would lose every search collision.

**Owner decision `[FACT — interview]`:** rename before further distribution; validate first; keep "AgentDeck" as codename/alias during migration.

**Rename process (Phase 0, gate for all distribution work):**

1. Generate 10–15 candidates (distinctive, pronounceable, no "agent-" prefix crowding; the vision doc's own AgentHarbor analysis is a starting point — but re-validate, that list is from before the collisions were known).
2. Validation checklist per candidate: GitHub org+repo free · npm unscoped free · PyPI/crates.io free (future-proofing) · .dev/.sh/.com domain available · Homebrew formula name free · no dominant search-result incumbent · USPTO TESS + EUIPO trademark search shows no live mark in software classes (`[ASSUMPTION]` a clean knockout search suffices at this stage; verify with an IP attorney before any paid launch).
3. Reserve everything the same day the name is chosen (GitHub org, npm name via placeholder publish, domains, social handles).
4. Migration: GitHub repo rename (redirects are automatic), README banner "formerly AgentDeck," `agentdeck` CLI kept as an alias binary for 2 minor versions, install.sh forwards.
5. **Deadline: chosen and reserved by 2026-09-30** — every distribution task in Phase 2 is blocked on it.

---

## 6. Monetization plan

### Model scorecard

Eight models scored (catalogue ids from the monetize-it framework), weight profile: adoption-first with a 12–24-month revenue horizon `[FACT — owner interview]`. Scale 1–5 (5 = best). Criteria compressed to the four that discriminate here: fit-to-archetype, time-to-first-revenue, effort/burden at 10–15 h/wk, and ceiling.

| Model (family) | Fit | Time to $ | Burden fit | Ceiling | Verdict |
|---|---:|---:|---:|---:|---|
| **F2 GitHub Sponsors** (Direct support) | 4 | 5 | 5 | 1 | **Do now.** Days to first dollar, zero product work. Real ceiling: lazygit's 81.6k★ converts to 184 sponsors `[FACT — github.com/sponsors/jesseduffield, 2026-08-24]`. Expect tens-to-low-hundreds $/mo at best. |
| **C1 Open-core** (Ecosystem) | 5 | 2 | 4 | 4 | **The chosen frame** (owner posture). Paid line drawn at team/cloud/governance features that don't exist yet — so it activates in Phase 4, not before. |
| **A10/A3 Hosted overlay subscription — "Deck Cloud"** (Recurring) | 5 | 2 | 3* | 4 | **Primary revenue engine, Phase 4+.** Thin automated relay: remote/mobile access, sync, shared team rooms. *Burden acceptable only because scope is a stateless-ish relay, not hosted agent execution — the graveyard (Terragon) hosted execution. |
| **A8 Team seats on the overlay** (Recurring) | 4 | 2 | 3 | 4 | The natural expansion of Deck Cloud once orgs/identity exist. Requires the multi-user model the code currently lacks (users table is scaffolding `[FACT — audit]`). |
| **D2 Sponsorship placements** (Attention) | 3 | 3 | 4 | 2 | Viable once there's a countable audience (newsletter/docs traffic). Media-kit-ready at ~5k★ / 10k monthly docs views. Phase 3+. |
| **A11 Support contracts** (Recurring) | 2 | 4 | 1 | 2 | Rejected for now: no production orgs run this, and a solo maintainer selling response-time promises is the classic burnout trap. Revisit 2028 if enterprises appear. |
| **B7 Digital products** (One-time) | 2 | 4 | 4 | 1 | Expected loser, scored for completeness: persona packs/room templates have no scarcity — the format is an open manifest. Marketplace evidence says <5% of MCP-style listings earn anything `[FACT — dev.to MCP monetization guide, 2026-08-24]`. |
| **C4 Enterprise licence** (Ecosystem) | 3 | 1 | 1 | 5 | Named and deferred: requires SSO/RBAC/audit + entity + sales calls. A 2028 conversation, gated on inbound pull. |

**Recommended portfolio (sequenced, per the standard OSS-infrastructure pattern):**

1. **Now (Phase 0):** GitHub Sponsors on — a passive test of goodwill, not a business model.
2. **Phase 4 (gated, see below):** Deck Cloud — free local core (forever) + paid overlay: **Pro ~$9/mo** (remote/mobile access, sync, push notifications — priced at the Omnara/AIDEN band `[FACT — pricing sweep, 2026-08-24]`) and later **Teams ~$15–20/user/mo** (shared rooms, admin). The niche's evidence: local orchestration is always free; money lives in remote access, team collaboration, and admin.
3. **Named but deferred:** sponsorship placements (Phase 3+), enterprise licence (2028+).

CrewAI's killed $25/mo prosumer tier is the pricing ceiling warning: stay under $10 for individuals, make the free tier genuinely complete locally, and charge for what physically cannot be local (relay, sync, team state).

### Unit economics (scenario, not forecast)

Inputs `[ASSUMPTION — planning defaults]`: ARPU $10/mo, variable cost $1.00/customer/mo (thin relay), fixed $50/mo, churn 6%/mo, CAC $0 (organic only), payment fees defaulted at 3.9%+$0.30 (verify processor/MoR pricing before launch). Derived `[ESTIMATE]`:

| Metric | Value |
|---|---|
| Contribution margin | $8.31/customer/mo (83.1%) |
| Break-even | **7 paying customers** ($70 MRR) |
| $1,000 MRR | 100 paying ≈ 3,334 total users at 3% conversion |
| $10,000 MRR | 1,000 paying ≈ 33,334 total users |
| LTV (margin-adjusted) | $138.50; worst-case sensitivity (ARPU −20%, cost +50%, churn 9%) still clears fixed cost at every rung |

The arithmetic message: **the business works at tiny scale if the free funnel exists** — 100 paying customers is a real side income; the binding constraint is the ~3k+ active free users needed to find them, which is why Phases 0–3 are entirely about adoption.

### Monetization gates (do not build billing before these)

- **Gate G1 (start designing Deck Cloud):** ≥2,000 GitHub stars OR ≥500 weekly npm installs, sustained a month.
- **Gate G2 (start charging):** G1 + ≥3 unsolicited "can I pay for remote access / team use?" asks + entity/MoR decision made (`[UNKNOWN]` entity status — resolve in Phase 4).
- **Gate G3 (Teams tier):** ≥5 organizations using shared decks in beta.

---

## 7. Phased roadmap

Capacity assumption: 10–15 h/wk founder time multiplied by AI agents `[FACT — interview]`. Phases overlap slightly; exit criteria are the real boundaries. Dates are targets, not promises.

### Phase 0 — Truth & Trust (Sep 2026, ~5 weeks)

*Make every claim true or delete the claim. Nothing else matters until a stranger's first 10 minutes are honest.*

| # | Task | Notes / evidence anchor |
|---|---|---|
| 0.1 | **Kill silent mock fallbacks** — codex/pi/kilo/cline + declarative plugins throw on missing binary like the other four adapters; surface `transport` in TUI + Web | `codex-adapter.ts:295` et al. |
| 0.2 | **Fix the security triad**: authenticate `/ws`; make `--lan` refuse to start without `--token`; add `Authorization` header to all Web Deck fetches | `server/src/index.ts:156-166`, `App.tsx` |
| 0.3 | **Real cost/token accounting**: propagate `execResult.tokensUsed/costUSD` instead of the hardcoded +150/+$0.0005; enforce `maxCostUSD` and `maxRuntimeSec` or remove them from schema+docs | `orchestration-engine.ts:355-356` |
| 0.4 | **Honest docs pass**: strip or fix every claim in §2's claimed-vs-code list (WebSocket streaming, coordinator, debate roles, manifest.yaml, `agentdeck docs`, RuntimeSession diagram…); document the hidden features (delivery traces, `run`, plugin CLI, hermes permission tiers) | README + docs/ |
| 0.5 | **Adapter metadata repair**: hermes install URL → `NousResearch/hermes-agent`; replace frozen `getLatestVersion()` constants with real lookups or "unknown"; re-point kilo/cline at their 2026 CLI packages | §3 ecosystem findings |
| 0.6 | **Wire the dead tables**: persist `orchestration_runs` (run history), write `audit_logs`, index `backups` (restore path exists already) | migrations.ts, three P1 wins |
| 0.7 | **Test the apps**: bring `apps/**` into the vitest glob; delete duplicate `test/`+`tests/` dirs; replace the self-referential TUI test | `vitest.config.ts:7` |
| 0.8 | **Name selection & validation** per §5 checklist | Deadline 2026-09-30 |
| 0.9 | Turn on **GitHub Sponsors** + FUNDING.yml | <1 h |
| 0.10 | Reposition **GarraIA adapter as a dogfooding/example adapter**, not an ecosystem peer of Claude Code/Codex | it resolves to the author's own 16★ GarraRUST `[FACT]` |

**Exit criteria:** a skeptical stranger can install, run a room with only the agents they actually have, see honest errors for the rest, and find zero untrue statements in README/docs. Name chosen and reserved. CI green with apps/ under test.

### Phase 1 — The Differentiator, made real (Oct – mid-Nov 2026, ~6 weeks)

*Owner's pick #2: group-chat depth. This is the Show HN demo being built.*

| # | Task | Notes |
|---|---|---|
| 1.1 | **Streaming end-to-end**: emit `run:chunk` from `executeSingleTurn` → event-bus → WS fan-out → Web Deck renders live tokens; TUI chat view streams | audit estimates ~150 LOC for the pipe; client work is the bulk |
| 1.2 | **Real coordinator mode**: plan → parse → delegate turns to specialist personas → synthesize; bounded by enforced turn/cost caps from 0.3 | replaces the one-turn stub at `orchestration-engine.ts:411` |
| 1.3 | **Parallel panel mode** (concurrent execution with per-agent streams), honoring per-process timeouts | currently sequential awaits |
| 1.4 | **Debate roles**: proposer/critique/synthesis turn structure the docs already promise | |
| 1.5 | **Run controls**: expose abort via REST/WS + stop buttons in TUI/Web (AbortSignal plumbing already exists) | `process-executor.ts:165` |
| 1.6 | **Room CRUD completion**: delete room, edit mode/limits post-creation; instance-level `edit` that actually edits | §2 gap 10 |
| 1.7 | **The demo**: a reproducible "Claude Code + Codex + Gemini debate a real bug fix, coordinator synthesizes, costs tracked live" recording (GIF + asciinema) | launch asset for Phase 2 |
| 1.8 | Execute the **rename migration** (§5 step 4) at the end of this phase, before any publicity | |

**Exit criteria:** the flagship demo runs live on a clean machine with 2+ real vendor agents; every room mode does what its name says; rename shipped.

### Phase 2 — Launch & Distribution (mid-Nov 2026 – Jan 2027)

*Channel priorities are evidence-ranked from the comparables' actual results `[FACT — §12 launch-channel data]`.*

| # | Task | Evidence for priority |
|---|---|---|
| 2.1 | **npm publish** under the new name; `npx <name>` as the one-line install; keep install.sh | the audience installs agents via npm at 22.6M+/week; Homebrew moves ~400 installs/30d for managers — later, minor |
| 2.2 | **awesome-list PRs**: awesome-claude-code (52,911★, has an Agent Orchestration section, accepting submissions) + sibling lists | Claude Squad hit 8.4k★ on lists/word-of-mouth alone |
| 2.3 | **Show HN** with the debate demo + narrative — never a bare repo link | comparables: Claudia 501 pts, Omnara 310, Conductor 228, Vibe Kanban 195 vs 3–5 pts for bare links |
| 2.4 | **r/ClaudeAI (1.06M members) + r/ChatGPTCoding (391k)** demo-GIF posts; repeatable monthly with new features | free, repeatable, exact target audience |
| 2.5 | **"Maintained successor" positioning**: comparison/migration docs for Vibe Kanban and opcode refugees; AlternativeTo listings | 50k+ stars of orphaned demand |
| 2.6 | Docs site (static, from existing docs/), demo videos, `CONTRIBUTING.md`, `SECURITY.md`, `CHANGELOG.md`, good-first-issues | conversion infrastructure for the traffic above |
| 2.7 | **Opt-in, anonymous usage ping** (documented, off by default, privacy-first) to measure WAU honestly | without it every KPI is stars-only guesswork; must not contradict the localhost-first trust story |
| 2.8 | Product Hunt + Homebrew tap | secondary: Omnara's PH: 452 upvotes; brew: convenience channel |

**Exit criteria / Gate G1 check:** ≥2,000 stars or ≥500 weekly npm installs sustained a month → Phase 4 design work may start. If the launch lands flat, iterate 2.3–2.5 monthly rather than pivoting.

### Phase 3 — Ecosystem standard-bearer (Feb – May 2027)

*Owner's deferred pick: adapter breadth — done the scalable way.*

| # | Task | Notes |
|---|---|---|
| 3.1 | **Generic ACP client adapter** — one adapter, 50+ registry agents; pilot with Gemini CLI (ACP-native) | §3 recommendation; the single highest-leverage engineering bet in the plan |
| 3.2 | Bespoke adapters where ACP is absent, by 2026 popularity: **opencode (200.9k★), Goose (53.4k★), OpenHands (84.9k★ — `--headless --json` JSONL is ideal), Qwen Code (shared Gemini-family base)** | replaces hand-rolled per-agent work with a ranked shortlist |
| 3.3 | **Finish the plugin SDK**: Tier-2 programmatic loader (`plugin install github:user/adapter`), `manifest.yaml`, opaque-arg prompt handling, streaming for declarative plugins, plugin enable/disable | "extensible ecosystem" currently means "fork the monorepo" `[FACT — audit]` |
| 3.4 | **AGENTS.md overlay engine**: compose personas/prompts into AGENTS.md canonically; mirror to CLAUDE.md etc. | 28+ tools read it natively |
| 3.5 | **Expose deck as an MCP server** (rooms, run history, agent status as MCP resources/tools) | lets any agent — including Claude Code itself — query the deck |
| 3.6 | Config export/import (`deck export > deck.yaml`), non-interactive setup for machine migration | vision-doc Q37–38; frequently requested in this category |
| 3.7 | Community: Discord, monthly release cadence notes, highlight third-party plugins | contributors are the only cure for solo bus-factor |

**Exit criteria:** a third-party ships an adapter without forking; ≥6 agents drivable on a clean machine, ≥2 via ACP.

### Phase 4 — Deck Cloud: first paid layer (H2 2027, **gated on G1/G2**)

*Open-core line: everything local stays MIT-free. Paid = what physically cannot be local.*

| # | Task | Notes |
|---|---|---|
| 4.1 | Identity: real local user model → optional account for cloud features (the `users`/`remote_user`/`public_key` scaffolding finally earns its keep) | |
| 4.2 | **Deck Relay**: E2E-encrypted remote/mobile access to your local deck + push notifications when an agent needs input | Happy (23.5k★) and Omnara prove the demand; relay ≠ hosted execution (the graveyard) |
| 4.3 | Sync: decks/personas/rooms across machines | |
| 4.4 | Billing: merchant-of-record (Paddle/Lemon Squeezy default for individual seller; revisit if entity exists `[UNKNOWN]`), entitlement checks server-side in the relay only — never license checks in the MIT core | |
| 4.5 | **Pro tier ~$9/mo** launch to a waitlist collected since Phase 2 | pricing evidence §6 |
| 4.6 | Teams beta (shared rooms, roles) at ~$15–20/user/mo — **Gate G3** | |

**Exit criteria:** first 100 paying customers (≈$1,000 MRR at the assumed ARPU — the "meaningful side income" rung `[ESTIMATE — §6 ladder]`).

### Phase 5 — Durability & upside (2028+, directional)

- Enterprise conversation **only if pulled** (SSO/RBAC/audit already partially exist as concepts by then): C4 custom licence, $25k+/yr anchor per Grafana's floor `[FACT — grafana.com/pricing, 2026-08-24]`.
- Sponsorship placements once the newsletter/docs audience is countable (D2).
- A2A bridge for federating rooms with remote enterprise agents — if A2A reaches local tooling.
- Persona/room-template registry — free and open; a paid marketplace only if the MCP-marketplace economy matures beyond its current <5%-earn-anything state.
- Succession/bus-factor plan: second maintainer with commit rights, documented release process.

---

## 8. Metrics and KPIs

| Phase | North-star metric | Supporting metrics |
|---|---|---|
| 0–1 | Honest-install success rate (clean-machine test, manual) | CI green incl. apps/; 0 untrue README claims |
| 2–3 | **GitHub stars + weekly npm installs** | WAU (opt-in ping), Discord members, awesome-list referral traffic, HN/Reddit post performance, retention of the demo→install funnel |
| 4 | **MRR + paying customers** | free→paid conversion (assumed 3% — measure!), churn (assumed 6% — measure!), relay infra cost/customer (assumed $1 — measure!), support minutes/customer |
| all | Unsolicited "can I pay?" count (log every one) | the single best willingness-to-pay signal per the discovery framework |

---

## 9. Risks and mitigations

| Risk | Evidence | Mitigation |
|---|---|---|
| **Platform encroachment** — Anthropic Managed Agents, Copilot delegating to third-party agents | `[FACT — §3]` | Vendor-neutrality is the counter-position; the giants structurally cannot manage each other's agents. Ride the wave: be the best *local* manager of their agents. |
| **Hosted-orchestration graveyard** — Terragon dead, Vibe Kanban cloud dead, CrewAI prosumer tier dead | `[FACT — §3]` | Deck Cloud is a thin relay, never hosted agent execution; billing gated on G1/G2 demand proof. |
| **Name migration cost** | 4 collisions `[FACT — §5]` | Do it now at ~0 installed base; alias binary + redirects; deadline 2026-09-30. |
| **Adapter rot** — agents rename orgs (sst→anomalyco, badlogic→earendil), change flags monthly | `[FACT — §3 ecosystem]` | ACP-first strategy; adapter CI smoke tests (level-3 doctor); version-check code paths that fail soft to "unknown," never to frozen constants. |
| **Solo bus factor / burnout** — 10–15 h/wk against a funded, crowded field | interview + §3 | AI-agent leverage; ruthless non-goals (§4); monthly release cadence over heroics; recruit a co-maintainer in Phase 3; Omnigent (the closest threat) is watched, not chased feature-for-feature. |
| **MIT fork risk** once traction exists | n8n cautionary `[FACT]` | Accepted cost of the license posture; moat = velocity, community, hosted layer. No retroactive license games. |
| **AGPL contamination** from studying competitors | Claude Squad, opcode, claudecodeui are AGPL `[FACT]` | Pattern-reference only MIT projects (ccmanager, Crystal); no code copying from AGPL repos. |
| **Trust damage from the current mocks** if discovered before Phase 0 ships | audit §2.1 | Phase 0.1 is the first task in the entire plan; no publicity of any kind until it lands. |
| **Telemetry backlash** in a privacy-positioned tool | 2.7 | Opt-in only, documented schema, localhost-first default unchanged. |

---

## 10. Next 30 days

1. **Today, <1 hour:** enable GitHub Sponsors + commit `FUNDING.yml`; start the "can I pay?" log (a text file).
2. **By 2026-08-28:** file GitHub issues for every §2 gap (P0/P1 labels) so the audit becomes a tracked backlog; delete the silent mock fallback in codex/pi/kilo/cline (0.1 — smallest highest-stakes diff).
3. **By 2026-09-05:** ship the security triad fix (0.2) and real cost accounting (0.3) as v1.1.0.
4. **By 2026-09-12:** honest-docs pass (0.4) + adapter metadata repair (0.5) as v1.1.1.
5. **By 2026-09-19:** name candidate shortlist generated and validated per §5 checklist (AI agents can run the whole registry/domain/search sweep; trademark knockout manually).
6. **By 2026-09-26:** wire run history/audit/backups tables (0.6); apps/ under test (0.7).
7. **By 2026-09-30:** name chosen, everything reserved. Phase 0 exit review against its criteria — then start Phase 1.1 (streaming).

---

## 11. Assumption register

| # | Assumption | Impact if wrong | Verify by |
|---|---|---|---|
| A1 | Traction ≈ 0 today | If real users exist, Phase 2 accelerates and G1 may already be near | GitHub insights, release download counts |
| A2 | Running cost ≈ $0/mo; no revenue | Break-even math shifts | invoices, none expected |
| A3 | Owner sells as individual, no entity (`[UNKNOWN]` — unanswered) | Direct Stripe vs MoR decision; B2B invoicing feasibility in Phase 4 | ask again at Gate G2; references: monetize-it geography-payments-tax |
| A4 | ARPU $10 / var-cost $1 / churn 6% / conv 3% for Deck Cloud | §6 ladder scales linearly; sensitivity table shows worst case still clears fixed cost | measure in Phase 4 beta before public pricing |
| A5 | ACP registry continues growing and stays open | Phase 3.1 falls back to bespoke adapters (ranked list in 3.2) | re-check agentclientprotocol.com registry quarterly |
| A6 | Rename cost is near-zero now | Every month of delay raises it | none needed — act by 2026-09-30 |
| A7 | 10–15 h/wk + AI leverage ≈ sustained throughput of roughly one focused engineer | Phase lengths stretch ~proportionally | monthly retro against phase exit criteria |
| A8 | Payment fees ~3.9%+$0.30 (MoR rates are higher, ~5%+) | Margin drops a few points; ladder still works | processor/MoR pricing page at Gate G2, with URL+date |

---

## 12. Sources

All retrieved 2026-08-24 unless noted. Star counts, prices, and download numbers drift — re-verify before external use.

**Competitors & ecosystem (GitHub API + repos):** asheshgoplani/agent-deck · smtg-ai/claude-squad · kbwo/ccmanager · BloopAI/vibe-kanban · Untrivial-ai/agent-orchestrator · omnigent-ai/omnigent · Yeachan-Heo/oh-my-claudecode · getpaseo/paseo · superset-sh/superset · slopus/happy · siteboon/claudecodeui · stravu/crystal · winfunc/opcode · omnara-ai/omnara · imbue-ai/sculptor · agent-of-empires/agent-of-empires · anthropics/claude-code · openai/codex · google-gemini/gemini-cli · anomalyco/opencode (via sst redirect) · NousResearch/hermes-agent · openclaw/openclaw · badlogic/pi-mono · michelbr84/GarraRUST · Aider-AI/aider · All-Hands-AI/OpenHands · QwenLM/qwen-code · cline/cline · Kilo-Org/kilocode · block/goose · charmbracelet/crush · hesreallyhim/awesome-claude-code · terragon-labs/terragon-oss

**Pricing pages (fetched live):** conductor.build/pricing · warp.dev/pricing · cursor.com/pricing · factory.ai/pricing · augmentcode.com/pricing · charlielabs.ai/pricing · claude.com/pricing · github.com/features/copilot/plans · jules.google (tiers w/o prices) · zed.dev/pricing · raycast.com/pricing · langchain.com/pricing · n8n.io/pricing · flowiseai.com · crewai.com/pricing · ghost.org/pricing · grafana.com/pricing · stripe.com/pricing. *Blocked/secondary-only:* devin.ai/pricing (HTTP 429), blitzy.com/pricing (403), Omnara (YC launch page), Jules prices (mlq.ai, digitalapplied.com), Nimbalyst (own blog), AIDEN (own guide), Sculptor (everydev.ai review).

**Registries & analytics:** registry.npmjs.org/agentdeck · registry.npmjs.org/agent-deck (404 = free) · api.npmjs.org weekly downloads (@anthropic-ai/claude-code, @openai/codex, opencode-ai, @google/gemini-cli, @sourcegraph/amp, vibe-kanban, agentdeck) · pypistats.org (aider-chat, omnara) · formulae.brew.sh (claude-squad, opencode, aider, gemini-cli, conductor cask, claude-code cask)

**Channels:** hn.algolia.com API (Show HN results for opencode, Claudia, Omnara, Conductor, Vibe Kanban, Claude Squad, agent-deck) · prowlo.com subreddit stats (r/ClaudeAI 1,061,416 members 2026-08-06; r/ChatGPTCoding 391,165 2026-08-07) · hunted.space / producthunt.com (Omnara)

**Protocols & standards:** agentclientprotocol.com · zed.dev/acp + zed.dev/blog/acp-progress-report · blog.modelcontextprotocol.io/posts/2026-07-28 · agents.md · linuxfoundation.org press (AAIF formation; A2A) · axios.com 2026-08-17 (A2A → AAIF)

**Monetization precedents:** github.com/sponsors/jesseduffield (184 sponsors) · opencollective.com/neovim ($528,143 all-time, ~$160k/yr budget) · plugins.jetbrains.com revenue-sharing docs (15% commission) · dev.to MCP-monetization guide (Smithery/Glama/MCPize figures, unverified) · docs.github.com Sponsors fees · techcrunch.com (Raycast $30M Series B; OpenClaw creator → OpenAI) · crunchbase.com (Charm ~$10M)

**Internal:** code audit of this repository at `e01faae` (file:line references throughout §2) · monetize-it repository scanner output 2026-08-24 · revenue_model.py run 2026-08-24 (inputs in §6/§11) · owner discovery interview, 2 rounds, 2026-08-24 · Multi-Agent-Organizer.md (the original 40-question product brief).

---

*This roadmap self-obsoletes: re-verify §3 quarterly (the field turned over completely between 2025 and 2026), re-run the §6 gates check monthly from Phase 2 on, and rewrite Phase 4+ the day real payment demand shows up earlier than planned.*
