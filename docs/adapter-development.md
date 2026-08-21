# Adapter SDK & Plugin Development Guide

AgentDeck allows easy integration of new CLI and autonomous agents through two extensible tiers.

---

## Tier 1: Declarative Simple Plugins (`manifest.json`)

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

AgentDeck will automatically detect and load this plugin on startup.

---

## Tier 2: Programmatic Full Plugins (`@agentdeck/adapter-sdk`)

For complex agents requiring custom health checks, JSON-RPC streaming, or configuration synchronization:

```typescript
import { AgentAdapter, ExecutionContext, ExecutionResult, DetectionResult } from '@agentdeck/adapter-sdk';
import { AgentDefinition, HealthReport, HealthCheckLevel } from '@agentdeck/protocol';

export class CustomAgentAdapter implements AgentAdapter {
  public readonly definition: AgentDefinition = {
    id: 'custom-agent',
    name: 'Custom Agent',
    description: 'Advanced custom agent',
    version: '1.0.0',
    capabilities: {
      install: true,
      upgrade: true,
      healthCheck: true,
      backupConfig: true,
      chat: true,
      streaming: true,
      interactiveTerminal: false,
      jsonRpcProtocol: false,
      nativeSystemPrompt: true,
      promptOverlaySupported: true,
      languageInjectionSupported: true,
      modelSelection: true,
      multipleInstances: true,
      nativeIdentity: false,
      tools: true,
      mcp: true,
      workspaceIsolation: true,
      nativeMemory: true,
      skills: false,
      channels: false,
    },
    rollbackCapabilities: { config: true, binary: false },
    supportedPlatforms: ['linux', 'darwin', 'win32'],
    supportedArchitectures: ['x64', 'arm64'],
  };

  public get capabilities() { return this.definition.capabilities; }
  public get rollbackCapabilities() { return this.definition.rollbackCapabilities; }

  public async detect(): Promise<DetectionResult> {
    // Custom detection logic
  }

  public async getLatestVersion() {
    // Registry query
  }

  public async checkHealth(level: HealthCheckLevel): Promise<HealthReport> {
    // Health checks
  }

  public async backupConfig(backupDir: string) {
    // Manifest-based backup
  }

  public async install() {
    // Installation script
  }

  public async upgrade() {
    // Upgrade script
  }

  public async rollback(backup: any) {
    // Configuration rollback
  }

  public async execute(context: ExecutionContext): Promise<ExecutionResult> {
    // Custom process execution and streaming
  }
}
```
