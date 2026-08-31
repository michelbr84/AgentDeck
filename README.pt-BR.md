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
- 🧭 **Um LLM para Todos os Agentes**: `agentdeck agents setup` instala os agentes gerenciados (**Claude Code**, **Hermes**, **OpenClaw**, **GarraIA**) e aponta todos para um mesmo par provedor + modelo (OpenRouter, Ollama, OpenAI, Anthropic ou o gateway local do GarraIA), com backup opcional. As configurações nativas são copiadas antes de cada aplicação; `agentdeck agents rollback` desfaz.
- 🔗 **Interoperabilidade entre Agentes via MCP**: `agentdeck agents link` registra o deck como servidor MCP dentro de cada agente, para que os agentes possam se descobrir, perguntar e postar uns aos outros através das salas — com rate limiting, limite de profundidade e detecção de ciclos.
- 🖥️ **Interface Dupla**:
  - **TUI Completa (Ink)**: Interface rica e responsiva direto no terminal com suporte a teclado.
  - **Web Deck (React + Vite + Tailwind CSS)**: Interface web moderna com streaming de tokens ao vivo e feed de eventos por sala, operações CRUD completas, a página **Agent Control** (status de instalação, roteamento de LLM, chaves de API, aplicar / dry-run) e a página **Groups** (salas como grupos de agentes).
- 🔌 **Ecossistema de Plugins Extensível**: Plugins declarativos (`manifest.json`/`manifest.yaml`) e adaptadores programáticos Tier-2 carregados via factory `createAdapter(sdk)`, instaláveis com `agentdeck plugin install` (fontes `github:` apenas com ref fixado).
- 🔒 **Segurança em Profundidade**: Vinculado por padrão a `127.0.0.1`, autenticação via token Bearer para rede local, redação recursiva de segredos/chaves de API, isolamento de permissões POSIX `0700` e chaves de API dos provedores guardadas em um cofre por provedor (`~/.agentdeck/secrets/`, modo `0600`) — nunca no SQLite.

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

# Executar diagnóstico de saúde em todos os agentes (ou em um específico, no nível escolhido)
agentdeck doctor
agentdeck doctor claude-code --level level2_connectivity

# Instalar/atualizar os agentes gerenciados e apontar todos para um único LLM
# (`agentdeck agents` sem subcomando executa `setup`)
agentdeck agents setup
printf '%s\n' "$OPENROUTER_API_KEY" | agentdeck agents setup \
  --provider openrouter --model z-ai/glm-5.3-flash \
  --backup-provider ollama --backup-model qwen3.5:2b \
  --api-key-stdin --yes

# Mostrar o que está instalado e para onde cada agente aponta
agentdeck agents status

# Restaurar as configurações copiadas antes de uma aplicação de roteamento (omita --run para listar)
agentdeck agents rollback --run <run-id>

# Registrar o servidor MCP do AgentDeck em cada agente para que possam se chamar
agentdeck agents link

# Expor este deck como servidor MCP via stdio (é o que `agents link` registra)
agentdeck mcp-server

# Chat em grupo interativo no terminal
agentdeck chat

# Navegar na documentação offline integrada
agentdeck docs
```

---

## 🧭 Roteamento de LLM e Interoperabilidade entre Agentes

O AgentDeck mantém **um único par provedor + modelo** (mais um backup opcional) para todo o deck e o escreve na configuração nativa de cada agente gerenciado — **Claude Code, Hermes, OpenClaw e GarraIA** — para que todos mudem juntos. Os provedores vêm de um catálogo curado (`openrouter`, `ollama`, `openai`, `anthropic`, `garraia-gateway`; qualquer id de modelo pode ser digitado, e a CLI confere ids do OpenRouter/Ollama ao vivo antes de escrever; o Web Deck oferece um botão **Test**). A configuração de cada agente é copiada para `~/.agentdeck/backups/routing-<run-id>/` antes de aplicar, e uma aplicação parcial ou indesejada é desfeita explicitamente com `agentdeck agents rollback --run <run-id>` — nunca revertida automaticamente. As chaves de API ficam apenas no cofre por provedor (`~/.agentdeck/secrets/<provedor>.key`, `0600`); o SQLite, a API REST e os logs só carregam uma referência `file:<provedor>`.

Para chamadas entre agentes, `agentdeck agents link` registra o `agentdeck mcp-server` (JSON-RPC via stdio; ferramentas `agentdeck_list_agents`, `agentdeck_ask`, `agentdeck_room_post`, `agentdeck_room_history`) em cada agente. Toda chamada passa pelos guardrails de interoperabilidade: a participação na sala é a allowlist, ciclos são cortados pelo caminho da chamada, e as cadeias são limitadas a profundidade 3, 12 turnos por conversa, fan-out 4 e 30 chamadas/min. No Web Deck, a página **Agent Control** mostra o status de instalação, permite definir o roteamento primário/backup e a chave de API, testar o provedor e aplicar (ou simular com dry-run) em todos os agentes; a página **Groups** transforma salas em grupos de agentes (criar, membros, modo, agente padrão). Veja [docs/help-faq.md](docs/help-faq.md) e [docs/architecture.md](docs/architecture.md).

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
```

---

## 📦 Estrutura do Monorepo

- `apps/cli`: CLI interativa, Assistente de Onboarding, comandos de provisionamento `agents`, servidor MCP e TUI em Ink (`agentdeck`).
- `apps/web`: Interface Web moderna em React, Vite e Tailwind CSS.
- `packages/core`: Orquestrador central, motor de estados, compositor de prompts, motor de upgrade, serviço de roteamento de LLM, catálogo de provedores e guardrails de interoperabilidade.
- `packages/protocol`: Esquemas tipados em Zod, eventos e contratos de dados.
- `packages/database`: Banco de dados operacional SQLite (modo WAL) com migrações Kysely.
- `packages/security`: Redação de segredos, cofre de segredos por provedor, gerador de tokens e validação segura.
- `packages/adapter-sdk`: SDK público para criação de adaptadores de agentes.
- `packages/adapters`: Adaptadores oficiais (Claude Code, Hermes, OpenClaw, GarraIA, Pi, Kilo, Cline, Codex).
- `packages/shared`: Caminhos do sistema, constantes, templates de personas e internacionalização.

---

## 📄 Licença

Distribuído sob a licença MIT. Consulte `LICENSE` para mais informações.
