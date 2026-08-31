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
- GitHub Tokens (classic `ghp_`/`gho_`/... and fine-grained `github_pat_...`)
- Slack tokens (`xoxb-...`) and JWT strings
- PEM private-key blocks (`-----BEGIN ... PRIVATE KEY-----`)
- Credential-bearing field names (`apiKey`, `authToken`, `password`, `clientSecret`, ...) — anchored patterns, so descriptive fields such as `authentication`, `tokensUsed`, or `secretsConfigured` stay readable (pinned by `packages/security/tests/redaction-precision.test.ts`)

---

## 2.1 Local User Profiles Are Not a Security Boundary

AgentDeck supports multiple local user profiles with per-room roles (owner / admin / participant / observer). Room mutations (edit, delete, member removal) honor these roles **cooperatively**: when a request identifies its profile (`x-agentdeck-user-id` header), rooms that record human members require owner/admin. The deck still authenticates with a single shared bearer token, so profiles are display identities and collaboration conveniences — anyone holding the deck token can act as any profile. Per-user authentication is intentionally out of scope for the local-first design.

---

## 3. Non-Destructive Configuration Overlays

AgentDeck never overwrites or corrupts native agent configuration files (`.claude.json`, `.hermes/config.json`, `.openclaw/openclaw.json`):
- Persona names, language constraints, and system prompts are injected as **prompt overlays** during runtime composition.
- Before executing any upgrade, AgentDeck creates a timestamped configuration snapshot in `~/.agentdeck/backups/<agent>/<timestamp>/` using an explicit `BackupManifest`.

---

## 3.5 Plugin Trust Model

Plugins extend AgentDeck with new agent adapters, in two tiers:
- **Tier-1 declarative** manifests describe CLI invocations only; the schema rejects shell metacharacters in commands and forces the prompt through opaque-content argument passing (`shell: false`).
- **Tier-2 programmatic** plugins are dynamically imported JavaScript running **in-process with your permissions — there is no sandbox**. Mitigations: `plugin install` requires explicit confirmation; `github:` sources must pin a tag or commit (moving branches are refused, so what you reviewed is what you run); every install writes a `.agentdeck-install.json` receipt with the exact source and ref; plugin loading is isolated per plugin so a broken one cannot take the deck down; and installation is CLI-only by design — there is deliberately no REST endpoint that installs code. Checksums/signatures and sandboxing are planned hardening.

---

## 4. Subprocess Execution Safety

- All agent binaries are executed with `shell: false` to prevent shell injection vulnerabilities.
- Subprocesses receive strict timeouts and graceful termination handlers (`SIGTERM` followed by `SIGKILL`).
