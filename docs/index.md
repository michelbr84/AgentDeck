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
   - CLI command reference
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
| `agentdeck doctor [agent]` | Run diagnostic Level 1 & Level 2 health checks across all agents, or a single one |
| `agentdeck chat <room>` | Start an interactive CLI chat session in a room |
| `agentdeck rooms list\|delete` | List rooms with limits, or delete one (messages cascade) |
| `agentdeck plugin install <src>` | Install a plugin from a local path or pinned `github:owner/repo#ref` |
| `agentdeck docs` | View built-in offline documentation directly in the terminal |
