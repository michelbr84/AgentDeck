# AgentDeck Documentation

Welcome to the **AgentDeck** documentation. AgentDeck is a unified agent management deck, orchestrator, and multi-agent group chat platform designed for Linux workstations (Ubuntu / Debian / WSL / macOS).

---

## 📚 Table of Contents

1. [Getting Started](getting-started.md)
   - System requirements
   - Quick one-line installation
   - Initial interactive onboarding (`agentdeck setup`)
2. [Architecture](architecture.md)
   - Monorepo package structure
   - Domain entity hierarchy
   - Capability negotiation protocol
   - SQLite WAL data layer & non-destructive overlays
   - LLM routing, secret store, agent interop (MCP) & REST endpoints
3. [Multi-Agent Group Chat Modes](group-chat-modes.md)
   - Mention Mode (`@Agent`, `@all`)
   - Broadcast / Panel Mode
   - Debate / Round-Robin Mode
   - Coordinator / Moderator Mode
4. [Prompt Composition & Provenance](prompt-composition.md)
   - Deterministic 8-layer prompt stack
   - Prompt inspection & token estimations
5. [Adapter SDK & Plugin Development](adapter-development.md)
   - Tier 1: Declarative Simple Plugins (`manifest.json` / `manifest.yaml`)
   - Tier 2: Programmatic Full Plugins (`@agentdeck/adapter-sdk`)
6. [Security & Hardening Model](security-model.md)
   - Secret redaction and credential protection
   - Localhost binding & LAN authentication
   - Non-destructive configuration isolation
7. [Help & FAQ](help-faq.md)
   - CLI command reference (incl. `agentdeck agents …` and `agentdeck mcp-server`)
   - Common troubleshooting steps

---

## ⚡ Quick CLI Commands

| Command | Description |
| :--- | :--- |
| `agentdeck setup` | Run the interactive agent discovery, setup, and configuration wizard |
| `agentdeck status` | Display the status, health, and versions of all agents |
| `agentdeck tui` | Launch the full-screen terminal user interface (TUI) |
| `agentdeck web` | Start the local REST/WebSocket daemon and open the Web Deck |
| `agentdeck upgrade <agent>` | Safely upgrade an agent with automated pre-upgrade configuration backups |
| `agentdeck doctor [agent]` | Run diagnostic Level 1–3 health checks across all agents, or a single one |
| `agentdeck agents setup` | Install/update the managed agents and point them all at one provider + model (plain `agentdeck agents` does the same) |
| `agentdeck agents status` | Show what is installed and where each agent currently points |
| `agentdeck agents rollback --run <id>` | Restore the agent configs backed up before a routing apply |
| `agentdeck agents link` | Register AgentDeck's MCP server in each agent so they can call each other |
| `agentdeck mcp-server` | Expose this deck as an MCP server over stdio (agent-to-agent calls) |
| `agentdeck chat <room>` | Start an interactive CLI chat session in a room |
| `agentdeck docs` | View built-in offline documentation directly in the terminal |
