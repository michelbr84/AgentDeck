#!/usr/bin/env node
import { Command } from 'commander';
import chalk from 'chalk';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { runSetupWizard } from './wizard/index.js';
import { AgentDeckManager, ChatService } from '@agentdeck/core';
import type { RoomMode } from '@agentdeck/protocol';
import { createAgentDeckServer } from '@agentdeck/server';

const program = new Command();

program
  .name('agentdeck')
  .description('Universal multi-agent manager, group chat deck, and orchestrator for Linux & Web')
  .version('1.0.3');

// 1. SETUP / ONBOARDING WIZARD
program
  .command('setup')
  .description('Interactive setup wizard for detecting, installing, configuring, and upgrading agents')
  .action(async () => {
    try {
      await runSetupWizard();
    } catch (err) {
      console.error(chalk.red(`\n✖ Setup error: ${(err as Error).message}`));
      process.exit(1);
    }
  });

// 2. STATUS & LIST & AGENTS
program
  .command('status')
  .alias('list')
  .alias('agents')
  .description('Display status and health matrix for all configured agents and installations')
  .action(async () => {
    const manager = await AgentDeckManager.create();
    const installations = await manager.scanAndSyncInstallations();
    const instances = await manager.listAgentInstances();

    console.log(chalk.bold.cyan('\n╭─────────────────────────────────────────────────────────────╮'));
    console.log(chalk.bold.cyan('│               AgentDeck Universal Agent Status              │'));
    console.log(chalk.bold.cyan('╰─────────────────────────────────────────────────────────────╯\n'));

    console.log(chalk.bold('Installed Blueprints & Binaries:'));
    for (const inst of installations) {
      const isInstalled = inst.state.installation === 'installed';
      const statusIcon = isInstalled ? chalk.green('● Installed') : chalk.gray('○ Not Installed');
      const verStr = inst.versionInstalled ? `v${inst.versionInstalled}` : 'none';
      const updateBadge =
        inst.state.version === 'outdated'
          ? chalk.yellow(` (Update available -> v${inst.versionLatest})`)
          : '';

      console.log(
        `  ${chalk.bold(inst.definitionId.padEnd(14))} ${statusIcon} [${verStr}]${updateBadge}`
      );
      if (inst.binaryPath) {
        console.log(`    ${chalk.dim('Path:')} ${chalk.dim(inst.binaryPath)}`);
      }
    }

    console.log(chalk.bold('\nConfigured Agent Instances (Personas):'));
    if (instances.length === 0) {
      console.log(chalk.dim('  No configured agent instances found. Run `agentdeck setup` or `agentdeck add` to create one.'));
    } else {
      for (const inst of instances) {
        console.log(
          `  ${chalk.yellow(inst.persona.avatarEmoji || '🤖')} ${chalk.bold(inst.name)} (${chalk.cyan(inst.persona.role)})`
        );
        console.log(
          `    ${chalk.dim('ID:')} ${inst.id} | ${chalk.dim('Engine:')} ${inst.installation.definitionId} | ${chalk.dim('Language:')} ${inst.persona.language}`
        );
      }
    }
    console.log('');
  });

// 3. AGENT INSTANCES (ADD / EDIT / REMOVE / DELETE)
program
  .command('add')
  .description('Create a new logical agent instance with custom persona, language, and system prompt')
  .action(async () => {
    await runSetupWizard({ mode: 'add' });
  });

program
  .command('edit [instanceName]')
  .description('Edit an existing agent instance persona, prompt overlay, language, or run upgrade check')
  .action(async (instanceName) => {
    await runSetupWizard({ mode: 'edit', targetName: instanceName });
  });

program
  .command('remove <instanceIdOrName>')
  .alias('delete')
  .description('Remove a configured agent instance by ID or name')
  .action(async (instanceIdOrName) => {
    const manager = await AgentDeckManager.create();
    const instances = await manager.listAgentInstances();
    const found = instances.find(
      (i) => i.id === instanceIdOrName || i.name.toLowerCase() === instanceIdOrName.toLowerCase()
    );
    if (!found) {
      console.error(chalk.red(`✖ Agent instance "${instanceIdOrName}" not found.`));
      process.exit(1);
    }
    await manager.deleteAgentInstance(found.id);
    console.log(chalk.green(`✔ Successfully removed agent instance "${found.name}" (${found.id}).`));
  });

// 4. RUN / CHAT / ORCHESTRATION
program
  .command('run <prompt>')
  .description('Execute an instant multi-agent orchestration prompt directly from the CLI')
  .option('-r, --room <roomName>', 'Room to run within (defaults to instant room)', 'cli-run')
  .option('-m, --mode <mode>', 'Orchestration mode (mention | panel | debate | coordinator)', 'panel')
  .action(async (promptText, options) => {
    const manager = await AgentDeckManager.create();
    const chatService = new ChatService(manager);

    const rooms = await manager.listRooms();
    let room = rooms.find((r) => r.name === options.room);
    if (!room) {
      const instances = await manager.listAgentInstances();
      const user = await manager.createOrGetLocalProfile('CLI User', '💻');
      room = await manager.createRoom({
        name: options.room,
        mode: options.mode as RoomMode,
        memberUserIds: [user.id],
        memberInstanceIds: instances.map((i) => i.id),
      });
    }

    console.log(chalk.bold.cyan(`\n🚀 Executing AgentDeck Orchestration [${options.mode.toUpperCase()}]...`));
    console.log(chalk.dim(`Prompt: "${promptText}"\n`));

    const result = await chatService.send({
      roomId: room.id,
      content: promptText,
      senderUserId: 'cli-user',
      senderDisplayName: 'CLI User',
      mode: options.mode as RoomMode,
      onTurnStart: (name) => console.log(chalk.yellow(`\n[Agent Turn: ${name}]`)),
      onChunk: (_, chunk) => process.stdout.write(chunk),
    });

    console.log(chalk.bold.green(`\n\n✔ Run completed: ${result.turnsExecuted} turns executed | Tokens: ~${result.tokensUsed} | Est. Cost: $${result.costUSD.toFixed(4)}\n`));
  });

program
  .command('chat [roomName]')
  .description('Enter interactive group chat mode with agents and human participants')
  .action(async (roomName) => {
    const { renderTui } = await import('./tui/index.js');
    await renderTui({ initialView: 'chat', initialRoom: roomName });
  });

// 5. DOCTOR / HEALTH CHECKS
program
  .command('doctor')
  .description('Perform multi-level diagnostic health checks across all installed agents')
  .option('--level <level>', 'Health check level (level1_static | level2_connectivity | level3_active)', 'level1_static')
  .action(async (options) => {
    const manager = await AgentDeckManager.create();
    console.log(chalk.bold.blue(`\nRunning AgentDeck Diagnostics (${options.level})...\n`));

    const adapters = manager.getAllAdapters();
    for (const adapter of adapters) {
      console.log(chalk.bold(`Checking ${adapter.definition.name} (${adapter.definition.id})...`));
      const report = await manager.checkAgentHealth(adapter.definition.id, options.level);

      for (const diag of report.diagnostics) {
        const icon =
          diag.status === 'pass'
            ? chalk.green('✓')
            : diag.status === 'warn'
            ? chalk.yellow('⚠')
            : chalk.red('✖');
        console.log(`  ${icon} [${diag.name}] ${diag.message}`);
      }
      console.log('');
    }
  });

// 6. UPGRADE AGENTS
program
  .command('upgrade [agentId]')
  .description('Execute transactional upgrade with pre-upgrade snapshot and automatic rollback on failure')
  .option('--dry-run', 'Generate upgrade plan without mutating binary or configs')
  .action(async (agentId, options) => {
    const manager = await AgentDeckManager.create();
    const adapters = agentId
      ? [manager.getAdapter(agentId)].filter(Boolean)
      : manager.getAllAdapters();

    if (adapters.length === 0) {
      console.error(chalk.red(`No agent found matching "${agentId}"`));
      return;
    }

    for (const adapter of adapters) {
      if (!adapter) continue;
      console.log(chalk.bold(`\nEvaluating upgrade for ${adapter.definition.name}...`));
      const plan = await manager.upgradeEngine.createPlan(adapter);
      console.log(`  Current Version: ${plan.currentVersion || 'None'}`);
      console.log(`  Target Version:  ${plan.targetVersion}`);
      console.log(`  Backup Directory: ${plan.backupPath}`);

      const result = await manager.upgradeEngine.executeUpgrade(adapter, {
        dryRun: !!options.dryRun,
        onProgress: (stage, pct) => console.log(`  [${pct || 0}%] ${stage}`),
      });

      if (result.success) {
        console.log(chalk.green(`✔ Upgrade completed successfully for ${adapter.definition.name}`));
      } else {
        console.log(chalk.red(`✖ Upgrade failed: ${result.error}. Rolled back: ${result.rolledBack}`));
      }
    }
  });

// 7. TERMINAL USER INTERFACE (TUI)
program
  .command('tui')
  .description('Launch full-featured interactive terminal deck UI (Ink)')
  .action(async () => {
    const { renderTui } = await import('./tui/index.js');
    await renderTui({ initialView: 'dashboard' });
  });

// 8. WEB DECK DAEMON (START / STOP / WEB)
program
  .command('web')
  .alias('start')
  .description('Start the local Fastify REST/WebSocket server and serve Web Deck')
  .option('-p, --port <number>', 'Server port', '4321')
  .option('--host <host>', 'Host to bind to', '127.0.0.1')
  .option('--lan', 'Allow local area network connections (0.0.0.0)')
  .option('--token <secret>', 'Mandatory authentication token for API and WebSocket')
  .option('--web-root <path>', 'Custom directory containing Web Deck static production build')
  .action(async (options) => {
    const port = parseInt(options.port, 10) || 4321;
    const server = await createAgentDeckServer({
      port,
      host: options.host,
      allowLan: !!options.lan,
      authToken: options.token,
      webRoot: options.webRoot,
    });

    if (!server.webRoot) {
      console.error(chalk.red('\n✖ Web UI bundle not found.'));
      console.error(chalk.yellow('Reinstall AgentDeck or run `pnpm --filter agentdeck-web build` if running from source.\n'));
      process.exit(1);
    }

    const bindHost = options.lan ? '0.0.0.0' : options.host || '127.0.0.1';
    await server.listen({ port, host: bindHost });
    console.log(chalk.bold.green(`\n🚀 AgentDeck Web Deck running at http://${bindHost}:${port}`));
    console.log(chalk.green('  ✓ Web UI: ready'));
    console.log(chalk.green('  ✓ REST API: ready'));
    console.log(chalk.green('  ✓ WebSocket: ready'));
    if (options.token) {
      console.log(chalk.yellow(`🔒 Authentication token required: ${options.token}`));
    }
  });

program
  .command('stop')
  .description('Stop running background AgentDeck daemon process')
  .action(() => {
    console.log(chalk.yellow('To stop foreground daemon, press Ctrl+C in its terminal session.'));
  });

// 9. PLUGIN MANAGEMENT (LIST / CREATE TEMPLATE)
const pluginCommand = program
  .command('plugin')
  .alias('plugins')
  .description('Manage declarative and programmatic AgentDeck plugins');

pluginCommand
  .command('list')
  .description('List installed user plugins from ~/.agentdeck/plugins')
  .action(async () => {
    const pluginsDir = path.join(os.homedir(), '.agentdeck', 'plugins');
    await fs.mkdir(pluginsDir, { recursive: true });
    const entries = await fs.readdir(pluginsDir, { withFileTypes: true });
    const pluginFolders = entries.filter((e) => e.isDirectory());

    console.log(chalk.bold.cyan('\n╭─────────────────────────────────────────────────────────────╮'));
    console.log(chalk.bold.cyan('│                 AgentDeck Installed Plugins                 │'));
    console.log(chalk.bold.cyan('╰─────────────────────────────────────────────────────────────╯\n'));

    if (pluginFolders.length === 0) {
      console.log(chalk.dim(`  No plugins installed in ${pluginsDir}`));
      console.log(chalk.dim('  Run `agentdeck plugin new <name>` to scaffold a new plugin.\n'));
      return;
    }

    for (const folder of pluginFolders) {
      const manifestPath = path.join(pluginsDir, folder.name, 'manifest.json');
      try {
        const raw = await fs.readFile(manifestPath, 'utf8');
        const json = JSON.parse(raw);
        console.log(`  🔌 ${chalk.bold(json.name || folder.name)} (${chalk.yellow(json.id || folder.name)}) [v${json.version || '1.0.0'}]`);
        console.log(`     ${chalk.dim(json.description || 'No description provided')}`);
      } catch {
        console.log(`  ⚠️  ${chalk.bold(folder.name)} (unrecognized manifest)`);
      }
    }
    console.log('');
  });

pluginCommand
  .command('new <pluginId>')
  .description('Scaffold a new declarative plugin in ~/.agentdeck/plugins/<pluginId>')
  .action(async (pluginId) => {
    const pluginsDir = path.join(os.homedir(), '.agentdeck', 'plugins', pluginId);
    await fs.mkdir(pluginsDir, { recursive: true });

    const sampleManifest = {
      apiVersion: 'agentdeck.io/v1alpha1',
      kind: 'AgentPlugin',
      id: pluginId,
      name: pluginId.charAt(0).toUpperCase() + pluginId.slice(1) + ' Plugin',
      version: '1.0.0',
      description: `Custom declarative plugin for ${pluginId}`,
      category: 'coding',
      detect: {
        which: pluginId,
        standardPaths: [`/usr/local/bin/${pluginId}`, `/usr/bin/${pluginId}`],
      },
      versionCheck: {
        command: pluginId,
        args: ['--version'],
        regex: '([0-9]+\\.[0-9]+\\.[0-9]+)',
      },
      execution: {
        command: pluginId,
        args: ['--prompt', '{{prompt}}'],
      },
      capabilities: {
        chat: true,
        streaming: true,
        promptOverlaySupported: true,
      },
    };

    const manifestPath = path.join(pluginsDir, 'manifest.json');
    await fs.writeFile(manifestPath, JSON.stringify(sampleManifest, null, 2), 'utf8');
    console.log(chalk.green(`\n✔ Scaffolded plugin manifest at ${manifestPath}`));
    console.log(chalk.dim('AgentDeck will automatically detect and load this plugin on next start.\n'));
  });

// 10. HELP & OFFLINE DOCS
program
  .command('docs')
  .description('Browse AgentDeck offline documentation and reference manuals')
  .action(async () => {
    const { renderTui } = await import('./tui/index.js');
    await renderTui({ initialView: 'docs' });
  });

program.parse(process.argv);
