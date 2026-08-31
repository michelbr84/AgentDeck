# Help & Frequently Asked Questions (FAQ)

---

## Command Reference

### `agentdeck setup`
Runs the interactive setup wizard to scan, install, upgrade, and configure agent runtimes and personas.

### `agentdeck status` (or `agentdeck list`)
Displays a comprehensive table showing all agent installations, versions, health states, and configured instances.

### `agentdeck add`
Interactive wizard to create a new agent instance with custom persona, system prompt overlay, and language.

### `agentdeck edit [instanceName]`
Edit existing agent instances or run targeted version upgrades.

### `agentdeck tui`
Launches the interactive Ink-based Terminal User Interface with dashboard, agent blueprint viewer, rooms list, live multi-agent chat deck, and offline docs browser.
- Navigation: `1..5` (1: Dashboard, 2: Agents, 3: Rooms, 4: Chat, 5: Docs), `Tab`, `Shift+Tab`, `Left/Right Arrow`.
- Chat Input: Press `i` or `Enter` in the Chat view to focus prompt input. Press `Esc` to unfocus and return to view navigation.

### `agentdeck web [--port <number>] [--host <host>] [--lan] [--token <secret>]`
Starts the AgentDeck REST and WebSocket daemon and serves the web application.

### `agentdeck upgrade [agentId] [--dry-run]`
Performs a safe, transactional upgrade of the specified agent, including pre-upgrade configuration backups and health verification.

### `agentdeck doctor [agentId] [--level <level>]`
Runs diagnostic checks across all agents — or a single agent when `agentId` is given (e.g. `agentdeck doctor claude-code`) — and prints detailed status reports (`level1_static`, `level2_connectivity` or `level3_active`).

### `agentdeck agents setup [--agents <ids>] [--provider <id>] [--model <id>] [--backup-provider <id>] [--backup-model <id>] [--api-key-stdin] [--per-agent] [--dry-run] [--force] [-y|--yes]`
Provisions the LLM-configurable agents (Claude Code, Hermes, OpenClaw, GarraIA) in one pass: detects what is installed, offers to install missing / upgrade outdated agents, asks for a primary and an optional backup provider + model, collects and verifies the API key when the provider needs one, validates the model ids (OpenRouter and Ollama are checked live), backs up every agent's config, and applies the same routing everywhere. `agentdeck agents` with no subcommand runs `setup` (intentional).
- Defaults: primary `openrouter` / `z-ai/glm-5.3-flash`, backup `ollama` / `qwen3.5:2b`; `--agents` is a comma-separated list of agent ids and defaults to all four managed agents.
- A key already stored, or the provider's env var (`OPENROUTER_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`), is reused and nothing is asked; otherwise `--api-key-stdin` reads the primary provider's key from the first line of stdin, or you are prompted. A key the provider explicitly rejects aborts the run and is not saved.
- Non-interactive (no TTY, or `--yes`): flags and defaults are used without prompts; missing agents are installed and outdated ones upgraded only with `--yes`; a model the provider does not list aborts instead of asking; the routing is applied to every selected agent.
- `--dry-run` reports the per-file diff without writing; `--force` overwrites config keys you hand-edited since the last apply.
- A partial apply is never auto-reverted — the command prints the run id to undo with `agentdeck agents rollback --run <id>`.
`--per-agent` walks through the selected agents one by one, asking whether each keeps the deck routing or gets its own primary provider/model (the deck backup remains its fallback); it needs an interactive terminal, so it cannot be combined with `--yes` or piped stdin.

### `agentdeck agents status`
Shows the deck routing (primary, backup, and which provider credentials are stored — never their values) and, for each managed agent, whether it is installed, which provider/model it currently points at, and its backup strategy (native, via GarraIA gateway, or none).

### `agentdeck agents rollback [--run <id>] [--agent <id>]`
Restores the native agent configs captured before a routing apply. Every apply stores its backups in `~/.agentdeck/backups/routing-<run-id>/` with a `manifest.json`; `--run <id>` restores (or removes) the files recorded there for every agent in the manifest, `--agent <id>` limits the restore to one agent, and omitting `--run` lists the runs available for rollback.

### `agentdeck agents link [--dry-run] [--garra-bin <path>]`
Wires the agents so they can call each other. It registers two MCP servers in the config of each installed, MCP-capable agent — `agentdeck` (`agentdeck mcp-server`) and `garraia` (`garra mcp-server`) — in `~/.claude.json` (Claude Code), `~/.openclaw/openclaw.json` (OpenClaw), `~/.hermes/config.json` (Hermes) and `~/.garraia/mcp.json` (GarraIA, which skips registering itself). Only missing entries are added; existing servers are never overwritten. It then prints the inter-agent call limits in force.

### `agentdeck mcp-server`
Runs AgentDeck as an MCP server over stdio (JSON-RPC; `initialize`, `tools/list`, `tools/call`). It exposes four tools: `agentdeck_list_agents` (instances and their rooms), `agentdeck_ask` (ask another instance and get its answer), `agentdeck_room_post` (post into a room) and `agentdeck_room_history` (read recent room messages). `ask` passes every interop guardrail — rate limiting, cycle detection, max depth, turn budget, conversation timeout and the room-membership allowlist — while `room_post` is only rate-limited and fan-out-capped. stdout carries only JSON-RPC; diagnostics go to stderr. You normally do not run it by hand: `agentdeck agents link` registers it in each agent.

### `agentdeck chat [roomId]`
Opens an interactive group chat session inside your terminal.

### `agentdeck plugin list`
Lists all user-installed declarative and programmatic plugins found in `~/.agentdeck/plugins`.

### `agentdeck plugin new <pluginId>`
Scaffolds a new declarative plugin manifest at `~/.agentdeck/plugins/<pluginId>/manifest.json`.

### `agentdeck docs`
Displays built-in offline documentation directly in your terminal.

---

## Frequently Asked Questions

### Q: Does AgentDeck modify my native agent configs (like `.claude.json`)?
**No.** AgentDeck uses non-destructive prompt overlays. Your native configuration files are never modified without explicit confirmation and automated snapshot backups.

### Q: Can I run multiple personas with the same agent?
**Yes.** You can create multiple instances of the same installed agent (e.g., Claude Code) with different personas (e.g. *Atlas* the Architect, *Sentinel* the Security Reviewer) and have them collaborate in the same room.

### Q: How do I add my own custom agent?
You can create a declarative plugin in `~/.agentdeck/plugins/<my-agent>/manifest.json` using `agentdeck plugin new <my-agent>`. See the [Adapter Development Guide](adapter-development.md) for details.

### Q: How do I point all my agents at the same LLM?
Run `agentdeck agents setup` (or open **Agent Control** in the Web Deck). One provider + model pair — plus an optional backup — is stored for the deck and written into the native config of Claude Code, Hermes, OpenClaw and GarraIA. Providers come from the catalog (`openrouter`, `ollama`, `openai`, `anthropic`, `garraia-gateway`); any model id can be typed. Each apply backs up the agents' configs first; undo with `agentdeck agents rollback --run <id>`. A per-instance override can be stored via `PUT /api/v1/instances/:id/llm-override`. See [Architecture](architecture.md#4-llm-routing-secret-store--agent-interop) for the design and REST endpoints.

### Q: Where are my provider API keys stored?
In a per-provider file, `~/.agentdeck/secrets/<provider>.key` (file mode `0600`, directory `0700`). The key never enters SQLite, the REST API, or a log — everything else handles a `file:<provider>` reference, and the API only reports *whether* a key is present (`GET /api/v1/secrets/status`).

### Q: How do agents call each other, and what stops them looping?
`agentdeck agents link` registers `agentdeck mcp-server` in every agent. Calls go through the deck (so the exchange lands in a room a human can read) and are checked by the interop guardrails in `packages/core/src/interop-guardrails.ts`: an agent can reach any instance that belongs to at least one room (room membership is the allowlist), a call chain refuses to re-enter an instance already on its path (cycle detection), and chains are capped at depth 3, 12 turns / 10 minutes per conversation, fan-out 4 and 30 calls per minute. `agentdeck agents link` prints these limits.

### Q: What do the Agent Control and Groups pages in the Web Deck do?
**Agent Control** shows each managed agent's install state (with Install / Upgrade / Health actions), the primary and backup provider + model, whether an API key is stored, a **Test** button for provider reachability, and **Save routing**, **Dry run** and **Apply to all agents** buttons; on a failed apply it names the run id to undo with `agentdeck agents rollback --run <id>`. **Groups** manages rooms as agent groups: create a room with a mode (`mention`, `panel`, `debate`, `round_robin`, `coordinator`), toggle agent instances as members, change the mode, and pick the default agent that answers untagged messages in mention mode.

### Q: How does AgentDeck secure local and LAN web access?
By default, AgentDeck binds strictly to `127.0.0.1`. When running with `--lan`, you must supply `--token <secret>`, which enforces mandatory HTTP Bearer tokens on all `/api/*` routes and WebSocket authentication. Without `--token`, the daemon additionally refuses `/api/*`, `/ws` and `/health` requests whose `Host` or `Origin` is not a loopback address (DNS-rebinding / cross-site protection), and any non-loopback `--host` requires `--token` as well.

### Q: How do I sign in to the Web Deck when the daemon was started with `--token`?
The Web Deck prompts you the first time the daemon answers 401: paste the secret you passed to `agentdeck web --token <secret>` into the "Authentication Required" dialog and press **Unlock**. Alternatively, open `http://127.0.0.1:4321/#token=<secret>` once — the Web Deck stores the token in the tab's `sessionStorage` and immediately removes it from the address bar (`?token=` is accepted too, but the fragment form never reaches the server, the Referer header or any access log). The token lives only for that browser tab (close the tab to forget it); a wrong token simply reopens the prompt. Note that the URL form still leaves the address you typed in the browser's history — on a shared machine, pasting into the dialog is the residue-free option — and a secret containing `%`, `&` or `#` must be URL-encoded when placed in the URL.
