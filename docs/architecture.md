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

---

## 4. LLM Routing, Secret Store & Agent Interop

### Deck-wide routing
- **One routing for the deck**: an `LlmRouting` is a primary `ProviderBinding` (`providerId`, `model`, optional `baseUrl`, `credentialRef`) plus an optional backup. It is stored in the `llm_routing` table and applied by `RoutingService` (`packages/core/src/routing-service.ts`) to every adapter implementing the `LlmConfigurable` contract (`packages/adapter-sdk/src/llm-configurable.ts`): Claude Code, Hermes, OpenClaw, GarraIA.
- **Provider catalog** (`packages/core/src/provider-catalog.ts`): `openrouter` (default primary, `z-ai/glm-5.3-flash`), `ollama` (default backup, `qwen3.5:2b`), `openai`, `anthropic`, `garraia-gateway`. The suggested model lists are a convenience — any model id is accepted; `validateModel` checks OpenRouter and Ollama ids against the live provider and fails *open* (`unknown`) when the provider is unreachable.
- **Three-phase apply**: back up every selected agent's config into `~/.agentdeck/backups/routing-<run-id>/` (abort the run if any backup fails) → dry-run every agent (abort before any write on a hard error) → apply sequentially. A failure after N−1 successes stops and reports; nothing is auto-reverted. `agentdeck agents rollback --run <id>` restores from the run's `manifest.json`.
- **Per-instance override**: an `AgentInstance` may carry its own `LlmRouting` (`GET` / `PUT /api/v1/instances/:id/llm-override`).

### Secret store
`packages/security/src/secret-store.ts` keeps one file per provider (`~/.agentdeck/secrets/<provider>.key`, mode `0600`, directory `0700`, re-asserted on every write). Outside that module only a `credentialRef` (`file:<provider>`) is stored in SQLite, shipped to agents, or returned by the API; `status()` exposes presence booleans only.

### Agent-to-agent interop (MCP + Rooms)
`agentdeck mcp-server` (`apps/cli/src/mcp-server.ts`) exposes the deck over MCP stdio with the tools `agentdeck_list_agents`, `agentdeck_ask`, `agentdeck_room_post` and `agentdeck_room_history`; `agentdeck agents link` registers it (and `garra mcp-server`) in each MCP-capable agent. Every `ask` / `room_post` passes `packages/core/src/interop-guardrails.ts`: room membership is the allowlist, cycles are detected by call path, and `DEFAULT_INTEROP_LIMITS` cap depth at 3, turns per conversation at 12, conversation time at 600 s, fan-out at 4, and calls at 30/min. Refusals are returned as structured tool errors, never thrown, and every exchange is recorded in a room.

### REST endpoints (LLM routing & provisioning)

| Method | Path | Purpose |
| :--- | :--- | :--- |
| `GET` | `/api/v1/agents/llm` | Per-agent LLM capability and what each agent currently points at |
| `GET` / `PUT` | `/api/v1/llm-routing` | Read (with credential presence) / store the deck-wide routing |
| `POST` | `/api/v1/llm-routing/apply` | Apply the stored routing (`{ dryRun?, force?, agentIds? }`); returns the run report and `runId` |
| `GET` / `PUT` | `/api/v1/instances/:id/llm-override` | Read / set a per-instance routing override (`{ routing }`; `null` clears) |
| `GET` | `/api/v1/secrets/status` | Which providers have a stored credential (booleans only) |
| `PUT` | `/api/v1/secrets/:provider` | Store a credential (`{ value }`); returns its `credentialRef`, never the value |
| `POST` | `/api/v1/providers/test` | Validate a `ProviderBinding` against the live provider |
| `GET` | `/api/v1/providers/catalog` | The provider catalog (ids, labels, default and suggested models, credential requirement) |
| `POST` | `/api/v1/agents/:id/install` | Install a missing agent |
