# AgentDeck (Português - Brasil)

<div align="center">

![AgentDeck Banner](https://raw.githubusercontent.com/michelbr84/AgentDeck/main/docs/assets/banner.png)

### Painel Unificado de Gerenciamento de Agentes e Chat em Grupo Multi-Agente

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-Ubuntu%20%7C%20Debian%20%7C%20Linux%20%7C%20macOS-emerald.svg)](docs/index.md)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.5+-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-20+-green.svg)](https://nodejs.org/)

[English](README.md) • [Português (Brasil)](README.pt-BR.md) • [Documentação](docs/index.md)

</div>

---

## 🌟 O que é o AgentDeck?

O **AgentDeck** é uma plataforma de gerenciamento e orquestração de agentes de IA para terminais Linux (Ubuntu/Debian) e navegadores web. Com um único comando no terminal, você configura, atualiza, audita e orquestra múltiplos agentes (**Claude Code**, **Hermes**, **OpenClaw**, **GarraIA**, **Pi**, **Kilo Code**, **Cline**, **Codex**) em salas de chat colaborativas com pessoas e agentes.

---

## ✨ Principais Recursos

- 🚀 **Instalação e Onboarding em 1 Comando**: Execute `agentdeck setup` para detectar, instalar e configurar seus agentes de forma interativa.
- 💬 **Chat em Grupo Multi-Agente**: Crie salas com pessoas e múltiplas personas de agentes (*Atlas*, *Sentinel*, *DevBot*, *Novelist*) suportando os modos **Menção (`@agente`)**, **Painel / Broadcast**, **Debate / Round-Robin** e **Coordenador**.
- 🛡️ **Overlays Não Destrutivos**: Configure prompts de sistema customizados e idiomas de resposta (ex: `pt-BR`) sem modificar ou corromper as configurações nativas dos agentes no seu computador.
- 🔄 **Upgrades Transacionais com Backup**: Criação automática de snapshots de backup antes de qualquer atualização de agente, com testes de saúde diagnósticos.
- 🖥️ **Interface Dupla**:
  - **TUI Completa (Ink)**: Interface rica e responsiva direto no terminal com suporte a teclado.
  - **Web Deck (React + Vite + Tailwind CSS)**: Interface web moderna com streaming em tempo real via WebSocket.
- 🔌 **Ecossistema de Plugins Extensível**: Suporte a plugins declarativos simples (`manifest.json`) e adaptadores completos (`@agentdeck/adapter-sdk`).
- 🔒 **Segurança em Profundidade**: Vinculado por padrão a `127.0.0.1`, autenticação via token Bearer para rede local, redação recursiva de segredos/chaves de API e isolamento de permissões POSIX `0700`.

---

## ⚡ Instalação Rápida no Ubuntu / Debian

```bash
curl -fsSL https://raw.githubusercontent.com/michelbr84/AgentDeck/main/scripts/install.sh | bash
```

---

## 🕹️ Comandos da CLI

```bash
# Executar assistente interativo de configuração e descoberta
agentdeck setup

# Ver status, diagnósticos de saúde e versões de todos os agentes
agentdeck status

# Abrir a interface de terminal completa (TUI)
agentdeck tui

# Iniciar o servidor local e abrir a interface Web
agentdeck web --port 4321

# Atualizar um agente com segurança e backup automático
agentdeck upgrade claude-code

# Executar diagnóstico de saúde em todos os agentes (ou em um específico)
agentdeck doctor
agentdeck doctor claude-code

# Chat em grupo interativo no terminal
agentdeck chat

# Navegar na documentação offline integrada
agentdeck docs
```

---

## 🏛️ Estrutura de Domínio

```text
 AgentDefinition (Catálogo e Adaptador)
       │
       ▼
 AgentInstallation (Binário real no sistema e versão detectada)
       │
       ▼
 AgentInstance (Instância lógica configurada)
       │
       ▼
 Persona (Identidade, Prompt de Sistema Customizado, Idioma pt-BR, Avatar)
       │
       ▼
 RuntimeSession (Turno de execução ativo, limites de tempo e custo)
```

---

## 📦 Estrutura do Monorepo

- `apps/cli`: CLI interativa, Assistente de Onboarding e TUI em Ink (`agentdeck`).
- `apps/web`: Interface Web moderna em React, Vite e Tailwind CSS.
- `packages/core`: Orquestrador central, motor de estados, compositor de prompts e motor de upgrade.
- `packages/protocol`: Esquemas tipados em Zod, eventos e contratos de dados.
- `packages/database`: Banco de dados operacional SQLite (modo WAL) com migrações Kysely.
- `packages/security`: Redação de segredos, gerador de tokens e validação segura.
- `packages/adapter-sdk`: SDK público para criação de adaptadores de agentes.
- `packages/adapters`: Adaptadores oficiais (Claude Code, Hermes, OpenClaw, GarraIA, Pi, Kilo, Cline, Codex).
- `packages/shared`: Caminhos do sistema, constantes, templates de personas e internacionalização.

---

## 📄 Licença

Distribuído sob a licença MIT. Consulte `LICENSE` para mais informações.
