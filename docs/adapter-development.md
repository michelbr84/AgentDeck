# Adapter SDK & Plugin Development Guide

AgentDeck allows easy integration of new CLI and autonomous agents through two extensible tiers.

---

## Tier 1: Declarative Simple Plugins (`manifest.json` / `manifest.yaml`)

For standard CLI agents that accept arguments and return text:

Create a folder in `~/.agentdeck/plugins/<plugin-id>/manifest.json`:

```json
{
  "apiVersion": "agentdeck.io/v1alpha1",
  "kind": "AgentPlugin",
  "id": "my-agent",
  "name": "My Custom Agent",
  "version": "1.0.0",
  "description": "Custom developer CLI assistant",
  "detect": {
    "which": "my-agent-cli"
  },
  "versionCheck": {
    "command": "my-agent-cli",
    "args": ["--version"],
    "regex": "([0-9]+\\.[0-9]+\\.[0-9]+)"
  },
  "install": {
    "command": "npm",
    "args": ["install", "-g", "my-agent-cli"]
  },
  "upgrade": {
    "command": "npm",
    "args": ["install", "-g", "my-agent-cli@latest"]
  },
  "execution": {
    "command": "my-agent-cli",
    "args": ["--prompt", "{{prompt}}"]
  },
  "capabilities": {
    "streaming": true,
    "chat": true
  }
}
```

AgentDeck will automatically detect and load this plugin on startup. Manifests may be written as `manifest.json`, `manifest.yaml`, or `manifest.yml`.

Validation rules enforced by the schema:
- `execution.args` must carry the `{{prompt}}` placeholder **exactly once, as its own argument** — the prompt is passed to the process as opaque user content (multi-line prompts, quotes and `$` are safe), never string-interpolated.
- `execution.command` must not contain shell metacharacters (processes are spawned with `shell: false`).

---

## Tier 2: Programmatic Full Plugins (`AgentPluginModule`)

For complex agents requiring custom detection, health checks, or streaming protocols, ship a **prebuilt ESM module** with a `createAdapter(sdk)` factory. Create `~/.agentdeck/plugins/<plugin-id>/` with:

`manifest.yaml`
```yaml
apiVersion: agentdeck.io/v1alpha1
kind: AgentPluginModule
id: custom-agent
name: Custom Agent
version: 1.0.0
description: Advanced custom agent
entry: index.mjs        # prebuilt ESM, relative to the plugin directory
engines:
  agentdeck: 1.0.0      # minimum AgentDeck version (optional)
```

`index.mjs`
```javascript
// IMPORTANT: do NOT import @agentdeck/* packages here. Plugins installed
// under ~/.agentdeck/plugins cannot resolve them in standalone installs —
// everything you need arrives injected through the `sdk` argument.
export function createAdapter(sdk) {
  return {
    definition: {
      id: 'custom-agent',
      name: 'Custom Agent',
      description: `Advanced custom agent (deck ${sdk.agentdeckVersion})`,
      version: '1.0.0',
      capabilities: { chat: true, streaming: true },
      rollbackCapabilities: { config: false, binary: false },
      supportedPlatforms: ['linux'],
      supportedArchitectures: ['x64', 'arm64'],
    },
    capabilities: { chat: true, streaming: true },
    rollbackCapabilities: { config: false, binary: false },

    async detect() {
      const res = await sdk.executeSafeCommand({ command: 'which', args: ['custom-agent'] });
      const bin = res.stdout.trim();
      return {
        installed: Boolean(bin),
        binaryPath: bin || null,
        version: null,
        state: {
          availability: 'available',
          installation: bin ? 'installed' : 'not_installed',
          configuration: 'configured',
          authentication: 'unknown',
          health: bin ? 'healthy' : 'unknown',
          version: 'unknown',
          runtime: 'stopped',
        },
      };
    },

    async getLatestVersion() {
      return { latestVersion: '1.0.0' };
    },

    async execute(context) {
      const out = await sdk.executeSafeCommand(
        {
          command: 'custom-agent',
          args: ['--prompt', { value: context.promptTree.finalRawPrompt, type: 'opaque-user-content' }],
          abortSignal: context.abortSignal,
          timeoutMs: context.turnRequest?.timeoutMs ?? 300000,
        },
        { onStdoutChunk: (chunk) => context.onChunk?.(chunk) }
      );
      return {
        content: out.stdout.trim(),
        tokensUsed: {
          input: { source: 'unknown' },
          output: { source: 'unknown' },
          total: { source: 'unknown' },
        },
        costUSD: { source: 'unknown' },
      };
    },
  };
}
```

Contract notes:
- The factory may be the **named export `createAdapter`** or the **default export**, sync or async.
- `definition.id`, `detect()` and `execute()` are required; other lifecycle methods (`install`, `upgrade`, `rollback`, `backupConfig`, `checkHealth`) are optional for loading but recommended.
- Plugins must ship **prebuilt JavaScript** (`.mjs`/ESM) — there is no transpiler in the runtime; compile TypeScript before packaging.
- `engines.agentdeck` is checked against the running deck version with semver comparison.

## Installing plugins

```bash
agentdeck plugin install ./my-plugin                 # local directory
agentdeck plugin install github:acme/my-plugin#v1.2.0 # PINNED tag or commit only
agentdeck plugin validate my-plugin                  # validate without loading into the deck
agentdeck plugin remove my-plugin
```

A plugin is code that runs inside AgentDeck with your permissions — there is no sandbox. `github:` installs therefore **require a pinned ref** (a moving default branch is refused), ask for explicit confirmation (`--yes` for scripts), and write a `.agentdeck-install.json` receipt recording the source and ref. Checksum/signature verification, a plugin registry, and sandboxing are planned follow-ups; until then, only install plugins whose source you have reviewed or whose author you trust.
