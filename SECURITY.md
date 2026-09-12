# Security Policy

AgentDeck is a local-first developer tool: the daemon binds to loopback by default and
provider keys never leave the machine unless you point the deck at a provider. This page
covers how to report vulnerabilities and what support looks like. The full hardening model
is documented in [docs/security-model.md](docs/security-model.md).

## Supported versions

Only the latest released minor line receives security fixes.

| Version | Supported |
|---------|-----------|
| 1.1.x   | ✅        |
| 1.0.x   | ❌ — please upgrade to the latest release |

## Reporting a vulnerability

**Please do not open a public issue for a security report.**

Use GitHub's private vulnerability reporting:
<https://github.com/michelbr84/AgentDeck/security/advisories/new>

Include:

- Affected version (`agentdeck --version`) or commit, and OS
- A minimal reproduction (redact real secrets — AgentDeck redacts its own logs, but
  double-check before pasting)
- Expected vs actual behavior, and your assessment of impact

What happens next:

1. Acknowledgment within 72 hours.
2. A fix targeted for the next patch or minor release, coordinated with you — you choose
   whether to be credited.
3. A GitHub Security Advisory is published once a fixed release is out.

## Scope

In scope (examples):

- **The REST/WebSocket daemon** (`packages/server`): auth bypass, DNS rebinding, CSRF or
  cross-site WebSocket access, SSRF beyond the documented residual risk in
  [docs/security-model.md](docs/security-model.md) §1.
- **The secret store and redaction layer** (`packages/security`): secret leakage into
  SQLite, logs, API responses, or WebSocket frames; broken `0600`/`0700` isolation.
- **Adapter config writing** (`packages/adapters`, `packages/adapter-sdk`): injection into
  native agent configuration files, destructive writes outside the documented backup flow.
- **Plugin loading** (`packages/core/src/plugin-loader.ts`): bypassing the pinned-ref or
  confirmation requirements, or the CLI-only install guarantee.
- **The CLI** (`apps/cli`): argument injection, unsafe defaults.

Out of scope:

- Attacks that require a malicious local user with your OS privileges or your deck token
  — that user is already inside the trust boundary (see `docs/security-model.md` §2.1).
- Social engineering of provider APIs (OpenRouter, Ollama, OpenAI, Anthropic) or of the
  managed agents themselves.
- Vulnerabilities in third-party agents or plugins you install that AgentDeck does not ship.

## Security practices in this repository

- Gitleaks scans every commit in CI (`.github/workflows/ci.yml`); `.gitleaks.toml`
  allowlists only fixtures with deliberately fake credentials.
- `.env` and credential files are gitignored; provider keys live in
  `~/.agentdeck/secrets/` (mode `0600`), never in the SQLite database.
- All agent subprocesses run with `shell: false`, strict argument validation, and
  SIGTERM→SIGKILL timeouts.
