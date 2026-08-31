# Security & Hardening Model

AgentDeck is built from the ground up for safe, defense-in-depth operation on developer machines.

---

## 1. Localhost Isolation & LAN Authentication

- **Strict Localhost Default**: The Web deck and REST daemon bind strictly to `127.0.0.1:4321`.
- **LAN Access Protection**: If LAN mode is enabled (`--lan`), authentication is mandatory via a high-entropy bearer token (`--token <secret>`).
- **Constant-Time Verification**: All token comparisons use `crypto.timingSafeEqual` to prevent timing attacks.
- **Local Request Guard (no-token mode)**: Without `--token`, `/api/*`, `/ws` and `/health` only answer requests whose `Host` header is a loopback literal (`localhost`, `127.0.0.0/8`, `[::1]`) and whose `Origin`, when present, is loopback as well. This blocks DNS-rebinding, cross-site `fetch` and cross-site WebSocket access from a browser; local CLIs and `curl` are unaffected. A non-loopback `--host` requires `--token`, exactly like `--lan`.
- **Provider Reachability Checks**: `POST /api/v1/providers/test` only contacts `http(s)` base URLs. By design, an authorized local user can make the daemon `GET <baseUrl>/api/tags` on any reachable host (Ollama on a LAN box is a supported setup); only reachability and whether the model is listed are reported.

---

## 2. Recursive Secret Redaction

AgentDeck scans and redacts sensitive credentials before logging or transmitting messages over WebSockets:
- Anthropic API Keys (`sk-ant-...`)
- OpenAI API Keys (`sk-proj-...` / `sk-...`)
- GitHub Tokens (`ghp_...`, `github_pat_...`)
- Generic Bearer tokens, private keys, and passwords

---

## 3. Non-Destructive Configuration Overlays

AgentDeck never overwrites or corrupts native agent configuration files (`.claude.json`, `.hermes/config.json`, `.openclaw/openclaw.json`):
- Persona names, language constraints, and system prompts are injected as **prompt overlays** during runtime composition.
- Before executing any upgrade, AgentDeck creates a timestamped configuration snapshot in `~/.agentdeck/backups/<agent>/<timestamp>/` using an explicit `BackupManifest`.

---

## 4. Subprocess Execution Safety

- All agent binaries are executed with `shell: false` to prevent shell injection vulnerabilities.
- Subprocesses receive strict timeouts and graceful termination handlers (`SIGTERM` followed by `SIGKILL`).
