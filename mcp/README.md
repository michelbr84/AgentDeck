# MCP Server Configs

Ready-to-merge MCP server configurations for Claude Code. Each JSON file here is a
drop-in fragment for the `mcpServers` key in `.claude/settings.json` (project scope)
or `~/.claude/settings.json` (user scope). Full integration walkthrough, including
what each server can do once connected:
[`docs/mcp-integrations.md`](../docs/mcp-integrations.md).

## Available servers

| File | Server | Transport | Auth |
|------|--------|-----------|------|
| `github-config.json` | `@modelcontextprotocol/server-github` | stdio (npx) | `GITHUB_TOKEN` from `.env` |
| `sentry-config.json` | Sentry (official remote) | HTTP | OAuth on first `/mcp` invocation |

## How to install

1. **Add tokens to `.env`** (copy from `.env.example`, fill in real values).
   Never commit `.env`.
2. **Merge the config** — copy the inner server object from the JSON file into the
   `mcpServers` key of `.claude/settings.json`. If the key does not exist yet, add it:

   ```json
   {
     "mcpServers": {
       "github": {
         "...": "... contents of mcp/github-config.json ..."
       }
     }
   }
   ```
3. **Restart Claude Code** and run `/mcp` to verify the server connects.

## GitHub

Requires a GitHub Personal Access Token with `repo` + `read:org` scopes (see
`.env.example`). The config passes the token through as `${GITHUB_TOKEN}` — the
value is read from your environment at server start and is never stored in this file.

## Sentry

The default configuration uses Sentry's hosted MCP endpoint
(`https://mcp.sentry.dev/mcp`) with OAuth — Claude Code walks you through
authorization the first time you invoke `/mcp`. No token needed for this path.

For a self-hosted Sentry, run the stdio variant (`@sentry/mcp-server`) instead and
set `SENTRY_ACCESS_TOKEN` + `SENTRY_HOST` in `.env`. See `.env.example` for the
required token scopes and `docs/mcp-integrations.md` for the walkthrough.

## Security notes

- Server fragments here contain **no secrets** — tokens live in `.env` (gitignored).
- Prefer the narrowest token scopes that work (`repo`, `read:org` for GitHub).
- Review any new MCP server config before merging it: a connected server gains
  tool access inside Claude Code under your permissions.
