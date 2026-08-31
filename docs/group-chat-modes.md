# Multi-Agent Group Chat Modes

AgentDeck features a multi-agent orchestration engine supporting four distinct conversation modes.

---

## 1. Mention Mode (`mention`)

In **Mention Mode**, agents only execute when specifically addressed in a message:
- Mention an agent: `@Atlas design the database schema`
- Mention multiple agents: `@Atlas @Sentinel review this PR`
- Mention everyone: `@all what do you think of this architecture?`

---

## 2. Broadcast / Panel Mode (`panel`)

In **Panel Mode**, every prompt submitted by the user is broadcast to all agent instances in the room, which execute **concurrently** (bounded lane pool, default 4 simultaneous turns). Each agent analyzes and answers the question independently from their persona's viewpoint (e.g. Architecture, Security, Implementation), and replies appear as each agent finishes; every reply records its pre-assigned `turnIndex`.

---

## 3. Debate Mode (`debate`)

In **Debate Mode**, agents take structured role-based turns (the room's default agent — or the first member — is the lead):
1. **Proposer** (lead): Proposes an initial architecture, implementation, or solution.
2. **Critique** (every other member, one turn each): Critiques the proposal for vulnerabilities, edge cases, and performance bottlenecks. In a single-agent room the lead critiques its own proposal.
3. **Synthesis** (lead): Synthesizes feedback into a finalized, hardened plan.

Each message persists its role in `rawPayload.debateRole`. The classic alternating behavior lives on unchanged in **Round-Robin Mode** (`round_robin`).

---

## 4. Coordinator / Moderator Mode (`coordinator`)

In **Coordinator Mode**, a lead agent instance (the room's default agent, or the first member) acts as the project manager, in three phases:
1. **Plan**: The lead breaks the user's objective into subtasks against the member roster, replying with a fenced JSON plan (`{"subtasks": [{"task", "specialist"}]}`); free-form plans degrade gracefully to a single delegated subtask.
2. **Delegate**: Each subtask runs on the best-matching specialist (by instance name, persona name, or persona role; round-robin fallback), concurrently and bounded by the interop fan-out cap.
3. **Synthesis**: The lead folds the specialists' answers into one final reply.

In a room where the lead is the only member, the plan turn is asked to answer directly and the run stops there.

---

## Orchestration Guardrails

Every room run enforces strict guardrails:
- **Max Turns Per Run**: Defaults to 10 (configurable per room).
- **Run Runtime Cap**: `maxRuntimeSec`, defaults to 600 seconds, checked between turns.
- **Per-Turn Timeout**: `turnTimeoutSec` per room (falls back to the deck default of 120s); a timed-out turn is aborted alone and the run continues.
- **Immediate Controls**: Real-time `STOP` via `POST /api/v1/runs/:runId/abort`, `POST /api/v1/rooms/:id/abort`, or a `{"type": "run:abort", "runId"}` WebSocket message — surfaced as the Stop button in the Web Deck and `ESC` in the TUI.
