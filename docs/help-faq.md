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
Launches the interactive Ink-based Terminal User Interface with dashboard, chat deck, and prompt inspector.

### `agentdeck web [--port <number>] [--lan] [--token <secret>]`
Starts the AgentDeck REST and WebSocket daemon and serves the web application.

### `agentdeck upgrade [agentId] [--dry-run]`
Performs a safe, transactional upgrade of the specified agent, including pre-upgrade configuration backups and health verification.

### `agentdeck doctor [--level <level>]`
Runs diagnostic checks across all agents and prints detailed status reports (`level1_static` or `level2_connectivity`).

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

### Q: How does AgentDeck secure local and LAN web access?
By default, AgentDeck binds strictly to `127.0.0.1`. When running with `--lan`, you can supply `--token <secret>` which enforces mandatory HTTP Bearer tokens on all `/api/v1/*` routes and WebSocket authentication.
