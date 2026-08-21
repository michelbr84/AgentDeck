# Architecture & Technical Design

AgentDeck is designed around clear boundaries between binaries on the host system, agent definitions, logical instances, and conversational personas.

---

## 1. Domain Entity Hierarchy

```text
 AgentDefinition (Blueprint / Catalog / Adapter)
       │
       ▼
 AgentInstallation (Host machine binary, paths, detected version, health state)
       │
       ▼
 AgentInstance (Configured logical agent unit, e.g. "Claude Senior", "Claude Reviewer")
       │
       ▼
 Persona (Identity overlay: Name, Role, Language, Custom System Prompt, Avatar, Style)
       │
       ▼
 RuntimeSession (Active execution lifecycle, process PID / stream / turn / conversation state)
```

1. **AgentDefinition**: Canonical declaration of capabilities, flags, and installation metadata.
2. **AgentInstallation**: Real binary detected or installed in `$PATH` or custom location.
3. **AgentInstance**: Logical agent configured by the user, linked to a specific installation and persona.
4. **Persona**: Identity definition (`Atlas`, `Sentinel`, `Novelist`, `DevBot`), custom system prompt overlay, avatar emoji, and language constraint (`pt-BR`, `en-US`, etc.).
5. **RuntimeSession**: Active execution turn in a room with token tracking and timeout guardrails.

---

## 2. Capability Negotiation Protocol

Adapters declare fine-grained capabilities:
- `install`, `upgrade`, `healthCheck`, `backupConfig`
- `chat`, `streaming`, `interactiveTerminal`, `jsonRpcProtocol`
- `nativeSystemPrompt`, `promptOverlaySupported`, `languageInjectionSupported`
- `mcp`, `tools`, `workspaceIsolation`, `skills`, `channels`

If an agent does not natively support custom system prompts, AgentDeck dynamically layers the prompt at the composition stage rather than rewriting native configuration files.

---

## 3. SQLite WAL Data Layer

All operational state is stored in `~/.agentdeck/data/agentdeck.db`:
- **WAL Mode**: Write-ahead logging enabled for concurrent CLI, TUI, and Web access.
- **Foreign Keys**: Enforced cascade and restrict rules.
- **Automated Versioned Migrations**: Built-in migration runner guarantees schema consistency.
