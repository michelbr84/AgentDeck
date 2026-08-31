# AgentDeck

<div align="center">

![AgentDeck Banner](https://raw.githubusercontent.com/michelbr84/AgentDeck/main/docs/assets/banner.png)

### Unified Agent Management Deck & Multi-Agent Group Chat Platform

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-Ubuntu%20%7C%20Debian%20%7C%20Linux%20%7C%20macOS-emerald.svg)](docs/index.md)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.5+-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-20+-green.svg)](https://nodejs.org/)

[English](README.md) • [Português (Brasil)](README.pt-BR.md) • [Documentation](docs/index.md)

</div>

---

## 🌟 What is AgentDeck?

**AgentDeck** is a terminal-first and browser-ready management deck and orchestration platform for autonomous AI agents. With a single command on Ubuntu/Debian/Linux, configure, upgrade, audit, and orchestrate all your AI agents (**Claude Code**, **Hermes**, **OpenClaw**, **GarraIA**, **Pi**, **Kilo Code**, **Cline**, **Codex**) in unified multi-agent collaborative group chats.

---

## ✨ Key Features

- 🚀 **Single Command Onboarding**: Run `agentdeck setup` for interactive agent detection, installation, and upgrade checks.
- 💬 **Multi-Agent Group Chat**: Create rooms with humans and multiple agent personas (*Atlas*, *Sentinel*, *DevBot*, *Novelist*) supporting **Mention (`@agent`)**, **Panel/Broadcast**, **Debate/Round-Robin**, and **Coordinator** modes.
- 🛡️ **Zero-Loss Non-Destructive Overlays**: Safely configure custom system prompts and response languages without corrupting upstream agent configurations.
- 🔄 **Transactional Upgrades & Backups**: Automated pre-upgrade snapshot backups and health verification before modifying agent binaries or settings.
- 🧭 **One LLM for Every Agent**: `agentdeck agents setup` installs the managed agents (**Claude Code**, **Hermes**, **OpenClaw**, **GarraIA**) and points them all at one provider + model pair (OpenRouter, Ollama, OpenAI, Anthropic, or the local GarraIA gateway) with an optional backup. Native configs are backed up before every apply; `agentdeck agents rollback` undoes it.
- 🔗 **Agent-to-Agent Interop over MCP**: `agentdeck agents link` registers the deck as an MCP server inside each agent, so agents can discover, ask, and post to each other through rooms — guarded by rate limiting, depth caps, and cycle detection.
- 🖥️ **Dual Interface**:
  - **Full-featured TUI (Ink)**: Responsive, keyboard-driven terminal user interface.
  - **Web Deck (React + Vite + Tailwind CSS)**: Modern browser deck with live token streaming and per-room event feed, full CRUD operations, an **Agent Control** page (install status, LLM routing, API keys, apply / dry-run) and a **Groups** page (rooms as agent groups).
- 🔌 **Extensible Plugin Ecosystem**: Declarative plugins (`manifest.json`/`manifest.yaml`) and programmatic Tier-2 adapters loaded via a `createAdapter(sdk)` factory, installable with `agentdeck plugin install` (pinned `github:` sources only).
- 🔒 **Security in Depth**: Localhost-by-default (`127.0.0.1`), LAN bearer token authentication, recursive secret redaction, `0700` filesystem isolation, and provider API keys kept in a per-provider secret store (`~/.agentdeck/secrets/`, mode `0600`) — never in SQLite.

---

## ⚡ Quick Install

```bash
curl -fsSL https://raw.githubusercontent.com/michelbr84/AgentDeck/main/scripts/install.sh | bash
```

---

## 🕹️ CLI Usage

```bash
# Launch interactive setup & discovery wizard
agentdeck setup

# View agent status, health reports, and versions
agentdeck status

# Launch the full-screen terminal user interface
agentdeck tui

# Launch the local Web Deck daemon
agentdeck web --port 4321

# Safely upgrade an agent with automatic backups
agentdeck upgrade claude-code

# Run health diagnostics (all agents, or a single one, at a chosen level)
agentdeck doctor
agentdeck doctor claude-code --level level2_connectivity

# Install/update the managed agents and point them all at one LLM
# (`agentdeck agents` with no subcommand runs `setup`)
agentdeck agents setup
printf '%s\n' "$OPENROUTER_API_KEY" | agentdeck agents setup \
  --provider openrouter --model z-ai/glm-5.3-flash \
  --backup-provider ollama --backup-model qwen3.5:2b \
  --api-key-stdin --yes

# Configure each agent individually: keep the deck routing or pick that agent's own primary
# (the deck backup stays as its fallback). Interactive only.
agentdeck agents setup --per-agent

# Show what is installed and where each agent currently points
agentdeck agents status

# Restore the configs backed up by a routing apply (omit --run to list runs)
agentdeck agents rollback --run <run-id>

# Register AgentDeck's MCP server in each agent so they can call each other
agentdeck agents link

# Expose this deck as an MCP server over stdio (what `agents link` registers)
agentdeck mcp-server

# Interactive terminal group chat
agentdeck chat

# Browse offline documentation
agentdeck docs
```

---

## 🧭 LLM Routing & Agent Interop

AgentDeck keeps **one provider + model pair** (plus an optional backup) for the whole deck and writes it into the native config of every managed agent — **Claude Code, Hermes, OpenClaw, and GarraIA** — so they all move together. Providers come from a curated catalog (`openrouter`, `ollama`, `openai`, `anthropic`, `garraia-gateway`; any model id can be typed, and the CLI checks OpenRouter/Ollama ids live before writing; the Web Deck offers a **Test** button). Every agent's config is backed up to `~/.agentdeck/backups/routing-<run-id>/` before an apply, and a partial or unwanted apply is undone explicitly with `agentdeck agents rollback --run <run-id>` — never auto-reverted. API keys live only in the per-provider secret store (`~/.agentdeck/secrets/<provider>.key`, `0600`); SQLite, the REST API, and logs only ever carry a `file:<provider>` reference.

For inter-agent calls, `agentdeck agents link` registers `agentdeck mcp-server` (stdio JSON-RPC; tools `agentdeck_list_agents`, `agentdeck_ask`, `agentdeck_room_post`, `agentdeck_room_history`) in each agent. Every call passes the interop guardrails: room membership is the allowlist, cycles are cut by call path, and chains are capped at depth 3, 12 turns per conversation, fan-out 4, and 30 calls/min. In the Web Deck, **Agent Control** shows install status, lets you set primary/backup routing and the API key, test the provider, and apply or dry-run to all agents; **Groups** turns rooms into agent groups (create, members, mode, default agent). See [docs/help-faq.md](docs/help-faq.md) and [docs/architecture.md](docs/architecture.md).

---

## 🏛️ Architecture Overview

```text
 AgentDefinition (Catalog & Adapter)
       │
       ▼
 AgentInstallation (Host machine binary & detected health)
       │
       ▼
 AgentInstance (Configured logical agent unit)
       │
       ▼
 Persona (Identity, Custom System Prompt Overlay, Language pt-BR/en-US, Avatar)
```

---

## 📦 Monorepo Structure

- `apps/cli`: Interactive CLI, Setup Wizard, `agents` provisioning commands, MCP server, and Ink Terminal UI (`agentdeck`).
- `apps/web`: React + Vite + Tailwind CSS Web Deck.
- `packages/core`: Core Orchestrator, State Machine Engine, Prompt Composer, Upgrade Engine, LLM Routing Service, Provider Catalog, Interop Guardrails.
- `packages/protocol`: Shared typed schemas, Zod definitions, Event Envelopes.
- `packages/database`: SQLite operational store in WAL mode with Kysely migrations.
- `packages/security`: Secret redaction, per-provider secret store, token generation, constant-time verification.
- `packages/adapter-sdk`: Public SDK for building simple and full agent adapters.
- `packages/adapters`: Built-in adapters for Claude Code, Hermes, OpenClaw, GarraIA, Pi, Kilo, Cline, and Codex.
- `packages/shared`: Common paths, logger, persona templates, and language constants.

---

## 📄 License

Distributed under the MIT License. See `LICENSE` for more information.
