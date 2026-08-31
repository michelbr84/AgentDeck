/**
 * `agentdeck agents link` — makes the agents able to call each other.
 *
 * Transport is MCP, semantics are Rooms.
 *
 * MCP over stdio was chosen over A2A because all four agents are already MCP
 * clients, a stdio server is a child process of the caller (no listening port,
 * no new auth surface), and GarraIA's A2A server — while complete and
 * multi-turn — keeps tasks in memory and carries no auth on its routes today.
 * A2A stays available as a secondary inbound path; it is not the backbone.
 *
 * Two servers get registered in each MCP-capable agent:
 *   - `garraia`   → `garra mcp-server`, exposing `garra_ask`.
 *   - `agentdeck` → `agentdeck mcp-server`, exposing the deck itself, so any
 *                   agent can reach any other and the exchange lands in a room.
 */
import path from 'node:path';
import os from 'node:os';
import chalk from 'chalk';
import { AgentDeckManager, DEFAULT_INTEROP_LIMITS } from '@agentdeck/core';
import {
  getPath,
  readJsonConfig,
  setPath,
  writeJsonConfigAtomic,
} from '@agentdeck/adapter-sdk';

export interface LinkOptions {
  dryRun?: boolean;
  /** Path to the `garra` binary; discovered from PATH when omitted. */
  garraBin?: string;
}

interface McpTarget {
  agentId: string;
  label: string;
  file: string;
  /** Dotted path to the agent's `mcpServers` map. */
  serversKey: string;
}

/** Where each agent keeps its MCP server registrations. */
function mcpTargets(): McpTarget[] {
  const home = os.homedir();
  return [
    {
      agentId: 'claude-code',
      label: 'Claude Code',
      file: path.join(home, '.claude.json'),
      serversKey: 'mcpServers',
    },
    {
      agentId: 'openclaw',
      label: 'OpenClaw',
      file: path.join(home, '.openclaw', 'openclaw.json'),
      serversKey: 'mcp.servers',
    },
    {
      agentId: 'hermes',
      label: 'Hermes',
      file: path.join(home, '.hermes', 'config.json'),
      serversKey: 'mcpServers',
    },
    {
      agentId: 'garraia',
      label: 'GarraIA',
      // Claude-Desktop-compatible file the Rust loader already merges.
      file: path.join(home, '.garraia', 'mcp.json'),
      serversKey: 'mcpServers',
    },
  ];
}

export async function runAgentsLink(options: LinkOptions = {}): Promise<void> {
  const manager = await AgentDeckManager.create();
  const installations = await manager.scanAndSyncInstallations();

  console.log(chalk.bold.cyan('\n  Ligando os agentes entre si (MCP + Rooms)\n'));

  const garraBin = options.garraBin ?? 'garra';
  const agentdeckBin = process.argv[1] ?? 'agentdeck';

  const registrations: Record<string, { command: string; args: string[] }> = {
    garraia: { command: garraBin, args: ['mcp-server'] },
    agentdeck: { command: process.execPath, args: [agentdeckBin, 'mcp-server'] },
  };

  let touched = 0;
  for (const target of mcpTargets()) {
    const inst = installations.find((i) => i.definitionId === target.agentId);
    const adapter = manager.getAdapter(target.agentId);
    if (!inst || !adapter) continue;

    if (inst.state.installation !== 'installed') {
      console.log(`  ${target.label.padEnd(14)} ${chalk.gray('– não instalado')}`);
      continue;
    }
    if (!adapter.capabilities.mcp) {
      console.log(`  ${target.label.padEnd(14)} ${chalk.gray('– não fala MCP')}`);
      continue;
    }

    let config: Record<string, unknown>;
    try {
      config = await readJsonConfig(target.file);
    } catch (err) {
      console.log(`  ${target.label.padEnd(14)} ${chalk.red('✖')} ${chalk.dim((err as Error).message)}`);
      continue;
    }

    // Register only what is missing; an agent may already point at a server we
    // do not own, and overwriting that would break its setup.
    const added: string[] = [];
    for (const [name, spec] of Object.entries(registrations)) {
      // Self-registration is pointless and would make GarraIA call itself.
      if (target.agentId === 'garraia' && name === 'garraia') continue;
      const key = `${target.serversKey}.${name}`;
      const existing = getPath(config, key);
      if (existing !== undefined) continue;
      setPath(config, key, spec);
      added.push(name);
    }

    if (added.length === 0) {
      console.log(`  ${target.label.padEnd(14)} ${chalk.dim('= já ligado')}`);
      continue;
    }

    if (options.dryRun) {
      console.log(
        `  ${target.label.padEnd(14)} ${chalk.yellow('dry-run')} ${chalk.dim(
          `registraria ${added.join(', ')} em ${target.file}`
        )}`
      );
      continue;
    }

    await writeJsonConfigAtomic(target.file, config);
    touched++;
    console.log(`  ${target.label.padEnd(14)} ${chalk.green('✔')} ${chalk.dim(added.join(', '))}`);
  }

  // Report the limits explicitly: an operator who cannot see the guardrails has
  // no way to know a call was refused rather than lost.
  console.log(chalk.bold('\n  Limites de chamada entre agentes\n'));
  console.log(`    profundidade máxima .......... ${DEFAULT_INTEROP_LIMITS.maxDepth}`);
  console.log(`    turnos por conversa .......... ${DEFAULT_INTEROP_LIMITS.maxTurnsPerConversation}`);
  console.log(`    timeout por turno ............ ${DEFAULT_INTEROP_LIMITS.turnTimeoutMs / 1000}s`);
  console.log(`    timeout por conversa ......... ${DEFAULT_INTEROP_LIMITS.conversationTimeoutMs / 1000}s`);
  console.log(`    alvos por broadcast .......... ${DEFAULT_INTEROP_LIMITS.maxFanOut}`);
  console.log(`    chamadas/min por instância ... ${DEFAULT_INTEROP_LIMITS.ratePerMinute}`);
  console.log(
    chalk.dim('\n    Ciclos são cortados pelo caminho da chamada, não só pela profundidade.\n')
  );

  if (touched > 0 && !options.dryRun) {
    console.log(
      `  ${chalk.bold('Pronto.')} Um agente agora alcança outro por ` +
        `${chalk.cyan('agentdeck_ask')} e ${chalk.cyan('agentdeck_room_post')}.\n`
    );
  }
}
