# Contributing to AgentDeck

Thanks for helping make AgentDeck better! This document covers the development setup, the
commands you need, and the conventions the project follows. Please also read
[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## Project overview

AgentDeck is a local-first management deck and multi-agent group-chat platform for AI
coding agents. Useful starting points:

- [README.md](README.md) — what AgentDeck is, quick install, CLI tour
- [docs/index.md](docs/index.md) — documentation hub
- [docs/architecture.md](docs/architecture.md) — monorepo layout and domain model
- [ROADMAP.md](ROADMAP.md) — where the project is heading (evidence-tagged)

## Development setup

Requirements: **Node.js 20+**, git, and **pnpm 11** — the repo pins `pnpm@11.22.0` via the
`packageManager` field (`corepack enable` sets it up); the lockfile and CI expect it.

```bash
git clone https://github.com/michelbr84/AgentDeck.git
cd AgentDeck
bash scripts/setup-dev.sh   # pnpm install + build + test + npm link
```

Or step by step: `pnpm install --frozen-lockfile`, `pnpm build`, then `npm link` inside
`apps/cli` to put the `agentdeck` binary on your PATH.

## Common commands

| Command           | What it does                                    |
|-------------------|-------------------------------------------------|
| `pnpm build`      | Build all packages in dependency order          |
| `pnpm test`       | Run the full vitest suite                       |
| `pnpm lint`       | ESLint                                          |
| `pnpm typecheck`  | `tsc -b` plus type-checking of every test file  |
| `pnpm clean`      | Remove dist/ and node_modules                   |

Tests live next to the code they cover (`packages/*/tests`, `apps/*/tests`) plus
cross-cutting suites in `tests/integration/`. Run a single suite with, for example:
`pnpm vitest run packages/core/tests/routing-service.test.ts`.

## How we work

- **Branches and PRs** — branch from `main` and open a pull request; direct pushes to
  `main` are not used.
- **Conventional Commits** — `feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:`;
  the PR title should follow the same format.
- **Tests** — new behavior ships with tests; bug fixes ship with a regression test that
  fails without the fix. CI (`.github/workflows/ci.yml`) runs build, lint, typecheck,
  tests, Gitleaks, and ShellCheck on every PR — all of them must pass.
- **Changelog** — user-facing changes get an entry under `[Unreleased]` in
  [CHANGELOG.md](CHANGELOG.md), following
  [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
- **Secrets** — never commit `.env`, tokens, or real credentials. Gitleaks runs in CI;
  `.gitleaks.toml` allowlists only fixtures with fake credentials. See
  [SECURITY.md](SECURITY.md) for the reporting policy.
- **Docs** — behavior changes update the relevant page under `docs/`; `README.md` and
  `README.pt-BR.md` stay in sync (each in its own language).

## Adding an adapter

The adapter SDK is the supported way to teach AgentDeck a new agent CLI. See
[docs/adapter-development.md](docs/adapter-development.md) for the Tier-1 (declarative
manifest) and Tier-2 (programmatic `@agentdeck/adapter-sdk`) paths, and
`packages/adapters/src/` for real examples.

## Reporting bugs and requesting features

Open a GitHub issue using the bug or feature templates. For security issues, follow
[SECURITY.md](SECURITY.md) — use private vulnerability reporting, not a public issue.

## License

By contributing, you agree that your contributions are licensed under the
[MIT License](LICENSE).
