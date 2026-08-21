# Prompt Composition & Provenance

AgentDeck uses a deterministic, layered prompt assembly pipeline to ensure robust persona execution, strict language constraints, and non-destructive configuration management.

---

## The 8-Layer Prompt Stack

When AgentDeck prepares a turn for an agent, it stacks 8 modular layers into a single prompt context:

```text
┌─────────────────────────────────────────────────────────┐
│ 1. Global System Policy (Base safety, conciseness)       │
├─────────────────────────────────────────────────────────┤
│ 2. Workspace Context (Project directory, git state)     │
├─────────────────────────────────────────────────────────┤
│ 3. Room Rules & Chat Mode Instructions                  │
├─────────────────────────────────────────────────────────┤
│ 4. Persona Identity & Custom System Prompt (Atlas, etc.)│
├─────────────────────────────────────────────────────────┤
│ 5. Agent-Specific Tuning & Tool Instructions            │
├─────────────────────────────────────────────────────────┤
│ 6. Response Language Constraint Directive (e.g. pt-BR)   │
├─────────────────────────────────────────────────────────┤
│ 7. Formatted Conversation History & Mentions Context    │
├─────────────────────────────────────────────────────────┤
│ 8. Incoming Trigger Message                             │
└─────────────────────────────────────────────────────────┘
```

### Layer Details

1. **Global System Policy**: Base orchestrator guidelines for clear, direct, and non-repetitive collaboration.
2. **Workspace Context**: Injects the active directory path, project name, and current repository status.
3. **Room Rules**: Formats constraints specific to the active room mode (`mention`, `panel`, `debate`, or `coordinator`).
4. **Persona Identity**: Injects the persona name, role description, and custom persona prompt overlay.
5. **Agent Engine Tuning**: Adapter-specific guidelines matching the capabilities of the underlying agent engine.
6. **Language Constraint**: Enforces the target communication language (e.g., `Portuguese (pt-BR)`, `English (en-US)`, `Spanish`, `French`, `German`, `Japanese`).
7. **Conversation History**: Formatted log of prior messages in the active thread/room with clear speaker attribution.
8. **Incoming Trigger Message**: The user or predecessor agent prompt that initiated this turn.

---

## Non-Destructive Overlays

Because AgentDeck does not overwrite native configuration files (such as `CLAUDE.md` or `openclaw.json`) to enforce persona behavior, you can run multiple distinct personas on the same installed binary concurrently without conflicting state.

---

## Prompt Inspection

You can inspect the generated prompt tree and token estimations programmatically via `@agentdeck/core` or through the Web UI and TUI deck before triggering execution.
