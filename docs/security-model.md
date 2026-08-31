# Security & Hardening Model

AgentDeck is built from the ground up for safe, defense-in-depth operation on developer machines.

---

## 1. Localhost Isolation & LAN Authentication

- **Strict Localhost Default**: The Web deck and REST daemon bind strictly to `127.0.0.1:4321`.
- **LAN Access Protection**: If LAN mode is enabled (`--lan`), authentication is mandatory via a high-entropy bearer token (`--token <secret>`).
- **Constant-Time Verification**: All token comparisons use `crypto.timingSafeEqual` to prevent timing attacks.

---

## 2. Recursive Secret Redaction

AgentDeck scans and redacts sensitive credentials before logging or transmitting messages over WebSockets:
- Anthropic API Keys (`sk-ant-...`)
- OpenAI API Keys (`sk-proj-...` / `sk-...`)
- GitHub Tokens (classic `ghp_`/`gho_`/... and fine-grained `github_pat_...`)
- Slack tokens (`xoxb-...`) and JWT strings
- PEM private-key blocks (`-----BEGIN ... PRIVATE KEY-----`)
- Credential-bearing field names (`apiKey`, `authToken`, `password`, `clientSecret`, ...) — anchored patterns, so descriptive fields such as `authentication`, `tokensUsed`, or `secretsConfigured` stay readable (pinned by `packages/security/tests/redaction-precision.test.ts`)

---

## 3. Non-Destructive Configuration Overlays

AgentDeck never overwrites or corrupts native agent configuration files (`.claude.json`, `.hermes/config.json`, `.openclaw/openclaw.json`):
- Persona names, language constraints, and system prompts are injected as **prompt overlays** during runtime composition.
- Before executing any upgrade, AgentDeck creates a timestamped configuration snapshot in `~/.agentdeck/backups/<agent>/<timestamp>/` using an explicit `BackupManifest`.

---

## 4. Subprocess Execution Safety

- All agent binaries are executed with `shell: false` to prevent shell injection vulnerabilities.
- Subprocesses receive strict timeouts and graceful termination handlers (`SIGTERM` followed by `SIGKILL`).
