# AgentDeck Project Timeline (hour-budgeted)

**Companion to [ROADMAP.md](ROADMAP.md)** — same baseline (v1.0.4, commit `e01faae`), same evidence base (code audit + market research retrieved 2026-08-24 + owner discovery interview). This document converts the roadmap's phases into an executable schedule **broken down by hours**.

**Start date:** Monday 2026-08-24 (Week 1).
**Evidence tags:** `[FACT]` verified · `[ESTIMATE]` derived by stated arithmetic · `[ASSUMPTION]` unverified premise with a verify-path.

---

## 1. Capacity model

| Input | Value | Tag |
|---|---|---|
| Founder hours/week | 10–15 h; **12 h/wk planning midpoint** | `[FACT — owner interview 2026-08-24]` (range), `[ASSUMPTION]` (midpoint) |
| AI-agent leverage | Heavy use of autonomous agents for dev, testing, research, docs | `[FACT — owner interview]` |
| What an "hour" below means | **Founder-hours of direction, review, and merge decisions.** Agent compute multiplies *output per founder-hour*; it does not add founder-hours. Tasks marked ≥70% delegable assume the founder writes the brief and reviews the diff; the agent does the middle. | `[ASSUMPTION]` — verify against actual velocity at each weekly retro |
| Re-planning rule | If measured velocity over any 3 weeks is <8 h/wk of founder time, **stretch the calendar, never cut Phase 0/1 scope.** Truth, security, and the differentiator are not negotiable; dates are. | policy |

**Hour-budget grand totals** `[ESTIMATE — sum of task rows below]`:

| Horizon | Founder-hours | Calendar |
|---|---:|---|
| Phase 0 (Truth & Trust) | **57 h** | Weeks 1–5 (Aug 24 – Sep 27, 2026) |
| Phase 1 (Differentiator) | **71 h** | Weeks 6–11 (Sep 28 – Nov 8, 2026) |
| Phase 2 (Launch) | **80 h** | Weeks 12–20 (Nov 9, 2026 – Jan 10, 2027; holiday-adjusted) |
| Phase 3 (Ecosystem) | **190 h** | Weeks 21–37 (Jan 11 – May 9, 2027) |
| **Cumulative to ecosystem maturity** | **≈ 398 h** | ~8.5 months |
| Phase 4 (Deck Cloud, gated) | **310 h** | H2 2027, only after Gates G1/G2 (ROADMAP §6) |
| Phase 5 | not budgeted | directional (ROADMAP §7) |

---

## 2. Phase 0 — Truth & Trust · 57 h · Weeks 1–5 (Aug 24 – Sep 27, 2026)

Goal: every claim true or deleted; name chosen and reserved. Task ids match ROADMAP §7.

| Task | What | Hours | Delegable | Week |
|---|---|---:|---:|---|
| 0.9 | Enable GitHub Sponsors + commit FUNDING.yml; start the "can I pay?" log | **1** | 20% | 1 |
| — | Convert the audit's P0/P1 findings into labeled GitHub issues (tracked backlog) | **2** | 80% | 1 |
| 0.1 | Kill silent mock fallbacks (codex/pi/kilo/cline + declarative plugins throw on missing binary; surface `transport` in TUI/Web) | **4** | 70% | 1 |
| 0.2 | Security triad: authenticate `/ws`; `--lan` refuses to start without `--token`; `Authorization` header on all Web Deck fetches | **8** | 60% | 1–2 |
| 0.3 | Real cost/token accounting (propagate adapter metrics; enforce `maxCostUSD`/`maxRuntimeSec` or remove from schema+docs) | **8** | 60% | 2 |
| — | **Release v1.1.0** (0.1–0.3): changelog, version bump, tag, tarballs | **2** | 50% | 2 |
| 0.4 | Honest docs pass (fix/delete every untrue claim; document hidden features: delivery traces, `run`, plugin CLI, hermes tiers) | **6** | 75% | 3 |
| 0.5 | Adapter metadata repair (hermes → `NousResearch/hermes-agent`; kill frozen `getLatestVersion()` constants; re-point kilo/cline at 2026 CLIs) | **5** | 70% | 3 |
| 0.10 | Reposition GarraIA as dogfooding/example adapter | **1** | 80% | 3 |
| — | **Release v1.1.1** (0.4–0.5) | **1** | 50% | 3 |
| 0.6 | Wire the dead tables: `orchestration_runs` history, `audit_logs`, `backups` index + restore path | **8** | 65% | 4 |
| 0.7 | Bring `apps/**` into vitest; delete duplicate `test/`+`tests/` dirs; real TUI test | **10** | 75% | 4–5 |
| 0.8 | Name selection & validation (agents run the registry/domain/search sweep per ROADMAP §5; founder does shortlist + trademark knockout + final call) | **6** | 60% | 2–5 |
| — | Phase 0 exit review against criteria; reserve chosen name everywhere same-day | **1** | 0% | 5 |
| | **Phase total** | **57 h** | | ≈ 11.4 h/wk ✅ within capacity |

**Milestones:** v1.1.0 (Sep 5) · v1.1.1 (Sep 12) · name chosen & reserved (**hard deadline Sep 30**) `[FACT — dates from ROADMAP §10]`.

---

## 3. Phase 1 — Differentiator, made real · 71 h · Weeks 6–11 (Sep 28 – Nov 8, 2026)

Goal: the flagship demo runs live on a clean machine; every room mode does what its name says; rename shipped.

| Task | What | Hours | Delegable | Week |
|---|---|---:|---:|---|
| 1.1 | Streaming end-to-end: `run:chunk` emitter → event-bus → WS fan-out → live tokens in Web Deck + TUI chat | **16** | 60% | 6–7 |
| 1.2 | Real coordinator mode: plan → parse → delegate to specialist personas → synthesize, bounded by the (now-enforced) caps | **14** | 55% | 8–9 |
| 1.3 | Parallel panel mode (concurrent execution, per-agent streams) | **6** | 65% | 9 |
| 1.4 | Debate roles: proposer / critique / synthesis structure | **5** | 70% | 9–10 |
| 1.5 | Run controls: abort via REST/WS + stop buttons in TUI/Web | **8** | 60% | 10 |
| 1.6 | Room CRUD completion: delete room, edit mode/limits post-creation, instance-level `edit` that edits | **8** | 75% | 10–11 |
| 1.7 | Demo assets: reproducible multi-vendor debate scenario, GIF + asciinema recording | **6** | 40% | 11 |
| 1.8 | Execute rename migration (repo rename, alias binary, README banner, install.sh forwarding) — **before any publicity** | **8** | 50% | 11 |
| — | **Release v1.2.0** under the new name | **(in 1.8)** | | 11 |
| | **Phase total** | **71 h** | | ≈ 11.8 h/wk ✅ |

**Milestones:** streaming live (Oct 11) · coordinator real (Oct 25) · demo recorded + rename shipped (Nov 8).

---

## 4. Phase 2 — Launch & Distribution · 80 h · Weeks 12–20 (Nov 9, 2026 – Jan 10, 2027)

Goal: Gate G1 (≥2,000 stars OR ≥500 weekly npm installs sustained a month — ROADMAP §6). Channel order is evidence-ranked `[FACT — ROADMAP §12 launch-channel data]`. Weeks 17–18 (Dec 21 – Jan 3) are planned at half pace for holidays.

| Task | What | Hours | Delegable | Week |
|---|---|---:|---:|---|
| 2.1 | npm publish pipeline under the new name (`npx <name>`), provenance, CI release automation | **8** | 65% | 12 |
| 2.6 | Docs site from existing docs/ + CONTRIBUTING.md, SECURITY.md, CHANGELOG.md, good-first-issues | **14** | 75% | 12–13 |
| 2.7 | Opt-in anonymous usage ping (off by default, documented schema, privacy-first) | **10** | 65% | 13–14 |
| 2.5 | "Maintained successor" positioning: Vibe Kanban / opcode comparison + migration docs; AlternativeTo listings | **8** | 70% | 14 |
| 2.2 | awesome-list PRs (awesome-claude-code Agent Orchestration section + siblings) | **3** | 60% | 14 |
| 2.4 | Reddit demo-GIF posts: r/ClaudeAI, r/ChatGPTCoding (first wave; repeat monthly) | **6** | 40% | 15 |
| 2.3 | **Show HN**: narrative + demo post, launch-day presence, comment response | **10** | 30% | 15–16 |
| 2.8 | Product Hunt + Homebrew tap | **6** | 60% | 19 |
| — | Community response, issue triage, first-contributor onboarding (standing, ~2 h/wk from launch) | **12** | 30% | 15–20 |
| — | Gate G1 review; if flat, iterate 2.3–2.5 monthly rather than pivoting | **3** | 20% | 20 |
| | **Phase total** | **80 h** | | ≈ 8.9 h/wk ✅ (holiday-adjusted) |

**Milestones:** npm live (Nov 15) · docs site (Nov 22) · Show HN (week of Dec 7 — Tue–Thu launch window) · G1 review (Jan 10).

---

## 5. Phase 3 — Ecosystem standard-bearer · 190 h · Weeks 21–37 (Jan 11 – May 9, 2027)

Goal: a third party ships an adapter without forking; ≥6 agents drivable, ≥2 via ACP.

| Task | What | Hours | Delegable | Weeks |
|---|---|---:|---:|---|
| 3.1 | Generic **ACP client adapter** (JSON-RPC over stdio; sessions, streaming, permission requests); pilot: Gemini CLI | **40** | 55% | 21–25 |
| 3.2 | Bespoke adapters by 2026 popularity: opencode, Goose, OpenHands (`--headless --json`), Qwen Code (Gemini-family base) | **30** | 70% | 25–28 |
| 3.3 | Plugin SDK completion: Tier-2 programmatic loader (`plugin install github:user/adapter`), `manifest.yaml`, opaque-arg prompts, streaming for declarative plugins, enable/disable | **35** | 60% | 28–32 |
| 3.4 | AGENTS.md overlay engine (compose once, mirror to CLAUDE.md et al.) | **20** | 65% | 32–34 |
| 3.5 | Expose deck as an MCP server (rooms, run history, agent status) | **16** | 65% | 34–35 |
| 3.6 | Config export/import (`deck export > deck.yaml`) + non-interactive setup | **14** | 70% | 36 |
| 3.7 | Community ops: Discord, monthly release notes, third-party plugin highlights, co-maintainer recruitment (standing ~1.5 h/wk) | **20** | 40% | 21–37 |
| — | Buffer / adapter-rot fixes (orgs rename, flags change — `[FACT]` sst→anomalyco, badlogic→earendil precedents) | **15** | 60% | as needed |
| | **Phase total** | **190 h** | | ≈ 11.2 h/wk ✅ |

**Milestones:** ACP pilot works with Gemini CLI (Feb 21) · first third-party adapter without a fork (Apr 4) · monthly release cadence unbroken.

---

## 6. Phase 4 — Deck Cloud, first paid layer · 310 h · H2 2027 (**gated**)

**Starts only after Gate G1 (adoption) and Gate G2 (≥3 unsolicited pay-asks + entity/MoR decision)** — ROADMAP §6. If gates are hit early, Phase 4 design may overlap Phase 3's tail; billing work never starts before G2. `[ASSUMPTION]` H2 2027 timing — verify monthly against the gates from Phase 2 on.

| Task | What | Hours | Delegable |
|---|---|---:|---:|
| 4.1 | Identity: real local user model → optional cloud account | **40** | 55% |
| 4.2 | **Deck Relay**: E2E-encrypted remote/mobile access + push notifications (relay, never hosted execution) | **90** | 50% |
| 4.3 | Sync: decks/personas/rooms across machines | **50** | 55% |
| 4.4 | Billing via merchant-of-record; server-side entitlements in the relay only — never license checks in the MIT core | **30** | 50% |
| 4.5 | Pro tier (~$9/mo) launch to the waitlist collected since Phase 2 | **20** | 40% |
| 4.6 | Teams beta (~$15–20/user/mo, shared rooms, roles) — Gate G3 | **50** | 50% |
| — | Ops/buffer (support, incidents, cost telemetry per customer) | **30** | 30% |
| | **Phase total** | **310 h** | ≈ 26 weeks at 12 h/wk |

**Exit:** first 100 paying customers ≈ $1,000 MRR `[ESTIMATE — ROADMAP §6 ladder]`.

---

## 7. Week-by-week calendar (Phases 0–2)

| Wk | Dates (2026–27) | Focus | Planned h |
|---:|---|---|---:|
| 1 | Aug 24 – Aug 30 | Sponsors+FUNDING.yml · issue backlog · kill silent mocks · start security triad | 12 |
| 2 | Aug 31 – Sep 6 | Finish security triad · cost accounting · **v1.1.0** · start name sweep | 13 |
| 3 | Sep 7 – Sep 13 | Honest docs pass · adapter metadata · GarraIA reposition · **v1.1.1** | 13 |
| 4 | Sep 14 – Sep 20 | Dead tables wired · apps/ tests begin | 12 |
| 5 | Sep 21 – Sep 27 | Tests done · name decision + reservations · **Phase 0 exit review** | 12 |
| 6 | Sep 28 – Oct 4 | Streaming: emitter + WS fan-out | 12 |
| 7 | Oct 5 – Oct 11 | Streaming: Web Deck + TUI clients live | 12 |
| 8 | Oct 12 – Oct 18 | Coordinator: plan→delegate loop | 12 |
| 9 | Oct 19 – Oct 25 | Coordinator done · parallel panel · debate roles start | 13 |
| 10 | Oct 26 – Nov 1 | Debate roles done · run controls (abort) · room CRUD start | 13 |
| 11 | Nov 2 – Nov 8 | Room CRUD done · demo recorded · **rename shipped, v1.2.0** | 14 |
| 12 | Nov 9 – Nov 15 | **npm publish** · docs site start | 11 |
| 13 | Nov 16 – Nov 22 | Docs site done · telemetry start | 11 |
| 14 | Nov 23 – Nov 29 | Telemetry done · successor docs · awesome-list PRs | 11 |
| 15 | Nov 30 – Dec 6 | Reddit wave 1 · Show HN prep | 10 |
| 16 | Dec 7 – Dec 13 | **Show HN** + response days | 10 |
| 17 | Dec 14 – Dec 20 | Community triage · iterate on feedback | 8 |
| 18 | Dec 21 – Jan 3 | Holiday half-pace: triage only | 6 (2 wks) |
| 19 | Jan 4 – Jan 10 | Product Hunt · Homebrew tap · **Gate G1 review** | 10 |

Phase 3 weekly detail is planned at its Week-20 kickoff using measured (not assumed) velocity from Weeks 1–19.

---

## 8. Standing weekly overhead (already inside phase budgets)

| Recurring item | h/wk | From |
|---|---:|---|
| Issue triage & community replies | 1–2 | Week 15 onward |
| Weekly retro: hours actually spent vs plan; adjust next week | 0.5 | Week 1 onward |
| Monthly: KPI check (stars, installs, WAU, pay-asks log) + Reddit demo post | ~1 | Week 12 onward |

---

## 9. Timeline risks specific to the schedule

| Risk | Trigger | Response |
|---|---|---|
| Velocity below plan | <8 founder-h/wk over 3 weeks | Stretch calendar; protect Phase 0/1 scope; drop 2.8 and 3.6 first |
| Estimate overrun on the two big unknowns (1.2 coordinator, 3.1 ACP) | task >150% of budget | Time-box: ship the bounded subset (coordinator with fixed 2-level delegation; ACP with Gemini CLI only), file the rest |
| Show HN lands flat | <50 points | Planned-for: iterate 2.3–2.5 monthly (ROADMAP §7); no schedule change |
| Gates hit early (viral moment) | G1 before Week 20 | Pull Phase 4 *design* forward; never pull billing before G2 |
| Holiday drift | Weeks 17–18 | Already budgeted at half pace |

---

*Maintained alongside ROADMAP.md: update actuals at the weekly retro, re-baseline at each phase exit review. Hour figures are `[ESTIMATE]` planning values derived from the 2026-08-24 code audit's gap list and the owner's stated capacity — they are budgets to steer by, not commitments.*
