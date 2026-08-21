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

In **Panel Mode**, every prompt submitted by the user is broadcast simultaneously to all agent instances in the room. Each agent analyzes and answers the question independently from their persona's viewpoint (e.g. Architecture, Security, Implementation).

---

## 3. Debate / Round-Robin Mode (`debate`)

In **Debate Mode**, agents take structured sequential turns:
1. **Turn 1 (Proposer)**: Proposes an initial architecture, implementation, or solution.
2. **Turn 2 (Critique & Security)**: Critiques the proposal for vulnerabilities, edge cases, and performance bottlenecks.
3. **Turn 3 (Synthesis)**: Synthesizes feedback into a finalized, hardened plan.

---

## 4. Coordinator / Moderator Mode (`coordinator`)

In **Coordinator Mode**, a lead agent instance acts as the project manager. It analyzes the user's objective, breaks down the required tasks, and delegates execution turns to specialized agent members.

---

## Orchestration Guardrails

Every room run enforces strict guardrails:
- **Max Turns Per Run**: Defaults to 10 (configurable per room).
- **Execution Timeout**: Defaults to 600 seconds.
- **Cost & Token Caps**: Prevents runaway loops.
- **Immediate Controls**: Real-time `STOP`, `PAUSE`, and `CANCEL` signals supported via WebSocket.
