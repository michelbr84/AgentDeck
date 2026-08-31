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
- 🖥️ **Dual Interface**:
  - **Full-featured TUI (Ink)**: Responsive, keyboard-driven terminal user interface.
  - **Web Deck (React + Vite + Tailwind CSS)**: Modern browser deck with real-time WebSocket streaming.
- 🔌 **Extensible Plugin Ecosystem**: Declarative plugins (`manifest.json`/`manifest.yaml`) and programmatic Tier-2 adapters loaded via a `createAdapter(sdk)` factory, installable with `agentdeck plugin install` (pinned `github:` sources only).
- 🔒 **Security in Depth**: Localhost-by-default (`127.0.0.1`), LAN bearer token authentication, recursive secret redaction, and `0700` filesystem isolation.

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

# Run health diagnostics (all agents, or a single one)
agentdeck doctor
agentdeck doctor claude-code

# Interactive terminal group chat
agentdeck chat

# Browse offline documentation
agentdeck docs
```

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
       │
       ▼
 RuntimeSession (Active execution turn, cost caps, token limits, abort signals)
```

---

## 📦 Monorepo Structure

- `apps/cli`: Interactive CLI, Setup Wizard, and Ink Terminal UI (`agentdeck`).
- `apps/web`: React + Vite + Tailwind CSS Web Deck.
- `packages/core`: Core Orchestrator, State Machine Engine, Prompt Composer, Upgrade Engine.
- `packages/protocol`: Shared typed schemas, Zod definitions, Event Envelopes.
- `packages/database`: SQLite operational store in WAL mode with Kysely migrations.
- `packages/security`: Secret redaction, token generation, constant-time verification.
- `packages/adapter-sdk`: Public SDK for building simple and full agent adapters.
- `packages/adapters`: Built-in adapters for Claude Code, Hermes, OpenClaw, GarraIA, Pi, Kilo, Cline, and Codex.
- `packages/shared`: Common paths, logger, persona templates, and language constants.

---

## 📄 License

Distributed under the MIT License. See `LICENSE` for more information.
