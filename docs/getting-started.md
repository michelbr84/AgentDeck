# Getting Started with AgentDeck

## System Requirements
- **OS**: Ubuntu 20.04+, Debian 11+, macOS 12+, or Windows WSL2 (Ubuntu).
- **Runtime**: Node.js 20 LTS or higher (`node -v`).
- **Package Manager**: `npm` or `pnpm` (pnpm 9+ recommended for development).

---

## Quick Installation

### One-Line Install Script
Install AgentDeck globally on your Ubuntu or Debian system with a single command:

```bash
curl -fsSL https://raw.githubusercontent.com/michelbr84/AgentDeck/main/scripts/install.sh | bash
```

This installer:
1. Verifies your operating system and Node.js runtime.
2. Creates the secure configuration directory tree (`~/.agentdeck/` with `0700` POSIX permissions).
3. Installs the `@agentdeck/cli` package and exposes the `agentdeck` command in `$PATH`.
4. Initializes the SQLite operational database (`~/.agentdeck/data/agentdeck.db`).

---

## First Run & Setup Wizard

After installation, run the onboarding wizard:

```bash
agentdeck setup
```

The wizard will:
1. Scan your system for supported agent runtimes:
   - **Claude Code** (Anthropic CLI)
   - **Hermes Agent**
   - **OpenClaw**
   - **GarraIA**
   - **Pi Assistant**, **Kilo Code**, **Cline**, and **Codex**
2. Offer to install missing agents or edit existing ones.
3. Automatically check if updates are available and offer a transactional upgrade with pre-upgrade snapshot backups.
4. Let you configure personas (e.g. Atlas, Sentinel, DevBot, Novelist), set custom system prompt overlays, and configure primary response languages (e.g. `pt-BR` or `en-US`).

---

## Launching the User Interfaces

### Terminal User Interface (TUI)
```bash
agentdeck tui
```
Full-featured interactive terminal deck with keyboard navigation (Arrows/Enter/Tab), tabs for Dashboard, Agent Directory, Room Manager, Live Group Chat, and System Prompt Inspector.

### Web Deck UI
```bash
agentdeck web --port 4321
```
Spawns the local Fastify daemon and opens the web application at `http://127.0.0.1:4321`.
