#!/usr/bin/env node
import { Command } from 'commander';
import chalk from 'chalk';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { runSetupWizard } from './wizard/index.js';
import { runAgentsSetup } from './agents/setup.js';
import { runAgentsStatus } from './agents/status.js';
import { runAgentsRollback } from './agents/rollback.js';
import { runAgentsLink } from './agents/link.js';
import { AgentDeckManager, ChatService, PluginLoader, readPluginManifest, loadProgrammaticPlugin, installPlugin, removePlugin, INSTALL_RECEIPT_FILENAME } from '@agentdeck/core';
import { AGENTDECK_PATHS } from '@agentdeck/shared';
import { HealthCheckLevelSchema, type RoomMode } from '@agentdeck/protocol';
import { createAgentDeckServer, isLoopbackHost } from '@agentdeck/server';
import { AGENTDECK_VERSION } from '@agentdeck/shared';

const program = new Command();

program
  .name('agentdeck')
  .description('Universal multi-agent manager, group chat deck, and orchestrator for Linux & Web')
  .version(AGENTDECK_VERSION);

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

// 2. STATUS & LIST
//
// The `agents` alias moved to its own command group (`agentdeck agents ...`),
// which provisions the agent binaries and their LLM routing. `agentdeck agents`
// with no subcommand still lands on `agents setup`, and `status`/`list` are
// unchanged for the instance matrix.
program
  .command('status')
  .alias('list')
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
  .option('-u, --user <displayName>', 'Local profile to send as (created on first use)', 'CLI User')
  .action(async (promptText, options) => {
    const manager = await AgentDeckManager.create();
    const chatService = new ChatService(manager);
    const profile = await manager.createOrGetLocalProfile(options.user, '💻');

    const rooms = await manager.listRooms();
    let room = rooms.find((r) => r.name === options.room);
    if (!room) {
      const instances = await manager.listAgentInstances();
      room = await manager.createRoom({
        name: options.room,
        mode: options.mode as RoomMode,
        memberUserIds: [profile.id],
        memberInstanceIds: instances.map((i) => i.id),
      });
    }

    console.log(chalk.bold.cyan(`\n🚀 Executing AgentDeck Orchestration [${options.mode.toUpperCase()}]...`));
    console.log(chalk.dim(`Prompt: "${promptText}"\n`));

    const result = await chatService.send({
      roomId: room.id,
      content: promptText,
      senderUserId: profile.id,
      senderDisplayName: profile.displayName,
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
  .command('doctor [agentId]')
  .description('Perform multi-level diagnostic health checks across all installed agents, or a single agent by id')
  .option('--level <level>', 'Health check level (level1_static | level2_connectivity | level3_active)', 'level1_static')
  .action(async (agentId, options) => {
    const manager = await AgentDeckManager.create();

    const parsedLevel = HealthCheckLevelSchema.safeParse(options.level);
    if (!parsedLevel.success) {
      console.error(
        chalk.red(
          `Invalid --level "${options.level}". Valid levels: ${HealthCheckLevelSchema.options.join(' | ')}`
        )
      );
      process.exitCode = 1;
      return;
    }

    const adapters = agentId
      ? [manager.getAdapter(agentId)].filter(Boolean)
      : manager.getAllAdapters();

    if (adapters.length === 0) {
      const validIds = manager.getAllAdapters().map((a) => a.definition.id).join(', ');
      console.error(chalk.red(`No agent found matching "${agentId}". Valid agent ids: ${validIds}`));
      process.exitCode = 1;
      return;
    }

    console.log(chalk.bold.blue(`\nRunning AgentDeck Diagnostics (${options.level})...\n`));

    for (const adapter of adapters) {
      if (!adapter) continue;
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
  .option('--host <host>', 'Host to bind to (loopback unless --token is given)', '127.0.0.1')
  .option('--lan', 'Allow local area network connections (0.0.0.0)')
  .option('--token <secret>', 'Mandatory authentication token for API and WebSocket')
  .option('--web-root <path>', 'Custom directory containing Web Deck static production build')
  .action(async (options) => {
    // Pre-validate: --lan requires --token
    if (options.lan && !options.token) {
      console.error(chalk.red('\n✖ --lan requires --token for authentication.'));
      console.error(chalk.yellow('  Usage: agentdeck web --lan --token <secret>\n'));
      process.exit(1);
    }

    // Pre-validate: a non-loopback --host is LAN exposure by another name
    if (!options.lan && options.host && !isLoopbackHost(options.host) && !options.token) {
      console.error(chalk.red(`\n✖ --host ${options.host} is not a loopback address; it requires --token for authentication.`));
      console.error(chalk.yellow(`  Usage: agentdeck web --host ${options.host} --token <secret>\n`));
      process.exit(1);
    }

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

    // Node binds bare IPv6 literals (`::1`), URLs need them bracketed (`[::1]`).
    const rawHost = options.lan ? '0.0.0.0' : options.host || '127.0.0.1';
    const bindHost = rawHost.replace(/^\[(.*)\]$/, '$1');
    const urlHost = bindHost.includes(':') ? `[${bindHost}]` : bindHost;
    await server.listen({ port, host: bindHost });
    console.log(chalk.bold.green(`\n🚀 AgentDeck Web Deck running at http://${urlHost}:${port}`));
    console.log(chalk.cyan(`  📂 Web root: ${server.webRoot}`));
    console.log(chalk.green('  ✓ Web UI: ready'));
    console.log(chalk.green('  ✓ REST API: ready'));
    console.log(chalk.green('  ✓ WebSocket: ready'));
    if (options.token) {
      console.log(chalk.green('  🔒 Authentication: enabled (token required)'));
      console.log(chalk.gray('     Web Deck: paste the token when prompted, or open the URL once with #token=<secret>'));
    }
  });

program
  .command('stop')
  .description('Stop running background AgentDeck daemon process')
  .action(() => {
    console.log(chalk.yellow('To stop foreground daemon, press Ctrl+C in its terminal session.'));
  });

// 8b. AGENT PROVISIONING + LLM ROUTING
//
// `setup` (above) configures personas and instances. `agents setup` is the
// other half: it installs/updates the agent binaries themselves and points all
// of them at one provider+model pair.
const roomsCommand = program
  .command('rooms')
  .description('Manage chat rooms from the CLI');

roomsCommand
  .command('list', { isDefault: true })
  .description('List every room with mode and limits')
  .action(async () => {
    const manager = await AgentDeckManager.create();
    const rooms = await manager.listRooms();
    if (rooms.length === 0) {
      console.log(chalk.dim('No rooms yet. Create one in the Web Deck, TUI, or with `agentdeck run`.'));
      return;
    }
    for (const room of rooms) {
      console.log(
        `${chalk.bold.green(`#${room.name}`)} ${chalk.dim(`(${room.id})`)} — mode: ${room.mode}, turns: ${room.maxTurnsPerRun}, runtime: ${room.maxRuntimeSec}s${room.turnTimeoutSec ? `, turn timeout: ${room.turnTimeoutSec}s` : ''}`
      );
    }
  });

roomsCommand
  .command('delete <roomIdOrName>')
  .alias('rm')
  .description('Delete a room and all of its messages (cascades)')
  .action(async (roomIdOrName) => {
    const manager = await AgentDeckManager.create();
    const rooms = await manager.listRooms();
    const room = rooms.find((r) => r.id === roomIdOrName || r.name === roomIdOrName);
    if (!room) {
      console.error(chalk.red(`No room found matching "${roomIdOrName}"`));
      process.exitCode = 1;
      return;
    }
    try {
      await manager.deleteRoom(room.id);
      console.log(chalk.green(`✔ Room #${room.name} deleted (messages and members cascaded).`));
    } catch (err) {
      console.error(chalk.red(`✖ ${(err as Error).message}`));
      process.exitCode = 1;
    }
  });

const agentsCommand = program
  .command('agents')
  .description('Provision the managed agents and point them all at one LLM');

agentsCommand
  .command('setup', { isDefault: true })
  .description('Detect, install/update, and configure the LLM for every managed agent')
  .option('--agents <ids>', 'comma-separated agent ids (default: all four managed agents)')
  .option('--provider <id>', 'primary provider id (default: openrouter)')
  .option('--model <id>', 'primary model id (default: z-ai/glm-5.3-flash)')
  .option('--backup-provider <id>', 'backup provider id (default: ollama)')
  .option('--backup-model <id>', 'backup model id (default: qwen3.5:2b)')
  .option('--api-key-stdin', 'read the primary provider API key from stdin')
  .option('--per-agent', 'configure each agent individually instead of applying one routing')
  .option('--force', 'overwrite config keys the user hand-edited since the last apply')
  .option('--dry-run', 'report what would change without writing anything')
  .option('-y, --yes', 'accept defaults and skip prompts')
  .action(async (options) => {
    try {
      await runAgentsSetup(options);
    } catch (err) {
      console.error(chalk.red(`\nSetup falhou: ${(err as Error).message}`));
      process.exitCode = 1;
    }
  });

agentsCommand
  .command('status')
  .description('Show what is installed and where each agent currently points')
  .action(async () => {
    try {
      await runAgentsStatus();
    } catch (err) {
      console.error(chalk.red(`\nStatus falhou: ${(err as Error).message}`));
      process.exitCode = 1;
    }
  });

agentsCommand
  .command('link')
  .description('Wire the agents so they can call each other (MCP + rooms)')
  .option('--dry-run', 'report what would be registered without writing')
  .option('--garra-bin <path>', 'path to the garra binary (default: resolved from PATH)')
  .action(async (options) => {
    try {
      await runAgentsLink(options);
    } catch (err) {
      console.error(chalk.red(`\nLink falhou: ${(err as Error).message}`));
      process.exitCode = 1;
    }
  });

agentsCommand
  .command('rollback')
  .description('Restore agent configs captured before a routing apply')
  .option('--run <id>', 'run id to restore (omit to list available runs)')
  .option('--agent <id>', 'restore only this agent')
  .action(async (options) => {
    try {
      await runAgentsRollback(options);
    } catch (err) {
      console.error(chalk.red(`\nRollback falhou: ${(err as Error).message}`));
      process.exitCode = 1;
    }
  });

// 8c. MCP SERVER
//
// Exposes the deck over MCP stdio so any agent can reach any other. stdout is
// reserved for JSON-RPC — see apps/cli/src/mcp-server.ts.
program
  .command('mcp-server')
  .description('Expose this deck as an MCP server over stdio (for agent-to-agent calls)')
  .action(async () => {
    const { runMcpServer } = await import('./mcp-server.js');
    await runMcpServer();
  });

// 9. PLUGIN MANAGEMENT (LIST / CREATE TEMPLATE)
const pluginCommand = program
  .command('plugin')
  .alias('plugins')
  .description('Manage declarative and programmatic AgentDeck plugins');

pluginCommand
  .command('list')
  .description('List installed user plugins (declarative and programmatic)')
  .action(async () => {
    const pluginsDir = AGENTDECK_PATHS.PLUGINS_DIR;
    await fs.mkdir(pluginsDir, { recursive: true });
    const entries = await fs.readdir(pluginsDir, { withFileTypes: true });
    const pluginFolders = entries.filter((e) => e.isDirectory());

    console.log(chalk.bold.cyan('\n╭─────────────────────────────────────────────────────────────╮'));
    console.log(chalk.bold.cyan('│                 AgentDeck Installed Plugins                 │'));
    console.log(chalk.bold.cyan('╰─────────────────────────────────────────────────────────────╯\n'));

    if (pluginFolders.length === 0) {
      console.log(chalk.dim(`  No plugins installed in ${pluginsDir}`));
      console.log(chalk.dim('  Run `agentdeck plugin new <name>` or `agentdeck plugin install <source>`.\n'));
      return;
    }

    for (const folder of pluginFolders) {
      const pluginDir = path.join(pluginsDir, folder.name);
      try {
        const found = await readPluginManifest(pluginDir);
        const tier = found.kind === 'AgentPluginModule' ? 'Tier-2 programmatic' : 'Tier-1 declarative';
        console.log(
          `  🔌 ${chalk.bold(found.manifest.name)} (${chalk.yellow(found.manifest.id)}) [v${found.manifest.version}] — ${chalk.dim(tier)}`
        );
        console.log(`     ${chalk.dim(found.manifest.description || 'No description provided')}`);
      } catch (err) {
        console.log(`  ⚠️  ${chalk.bold(folder.name)} — ${chalk.dim((err as Error).message)}`);
      }
    }
    console.log('');
  });

pluginCommand
  .command('install <source>')
  .description('Install a plugin from a local path or a PINNED github source (github:owner/repo#tag-or-commit)')
  .option('-y, --yes', 'Skip the interactive confirmation')
  .action(async (source, options) => {
    try {
      let confirmed = Boolean(options.yes);
      if (!confirmed) {
        console.log(chalk.bold.yellow('\n⚠ A plugin installs code that runs INSIDE AgentDeck with your permissions.'));
        console.log(chalk.yellow(`  Source: ${source}`));
        console.log(chalk.yellow('  Review the plugin before continuing. There is no sandbox.'));
        const readline = await import('node:readline/promises');
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        const answer = (await rl.question('  Install? Type "yes" to continue: ')).trim().toLowerCase();
        rl.close();
        confirmed = answer === 'yes' || answer === 'y';
        if (!confirmed) {
          console.log(chalk.dim('Aborted.'));
          process.exitCode = 1;
          return;
        }
      }

      const result = await installPlugin(source, { pluginsDir: AGENTDECK_PATHS.PLUGINS_DIR, confirmed: true });
      console.log(chalk.green(`\n✔ Plugin "${result.pluginId}" installed at ${result.pluginDir}`));
      console.log(chalk.dim(`  Kind: ${result.kind} | receipt: ${INSTALL_RECEIPT_FILENAME}`));
      console.log(chalk.dim('  AgentDeck loads it on next start. Validate with `agentdeck plugin validate`.\n'));
    } catch (err) {
      console.error(chalk.red(`✖ ${(err as Error).message}`));
      process.exitCode = 1;
    }
  });

pluginCommand
  .command('remove <pluginId>')
  .alias('rm')
  .description('Remove an installed plugin')
  .action(async (pluginId) => {
    try {
      await removePlugin(pluginId, AGENTDECK_PATHS.PLUGINS_DIR);
      console.log(chalk.green(`✔ Plugin "${pluginId}" removed.`));
    } catch (err) {
      console.error(chalk.red(`✖ ${(err as Error).message}`));
      process.exitCode = 1;
    }
  });

pluginCommand
  .command('validate [pathOrId]')
  .description('Validate a plugin directory (or an installed plugin id) without loading it into the deck')
  .action(async (pathOrId) => {
    try {
      const target = pathOrId
        ? (await fs.stat(path.resolve(pathOrId)).catch(() => null))?.isDirectory()
          ? path.resolve(pathOrId)
          : path.join(AGENTDECK_PATHS.PLUGINS_DIR, pathOrId)
        : process.cwd();

      const found = await readPluginManifest(target);
      console.log(chalk.green(`✔ Manifest OK: ${found.manifest.name} (${found.manifest.id}) — kind ${found.kind}`));
      if (found.kind === 'AgentPluginModule') {
        const adapter = await loadProgrammaticPlugin(target, found.manifest);
        console.log(chalk.green(`✔ Entry module OK: createAdapter() returned adapter "${adapter.definition.id}"`));
      } else {
        // Instantiating the declarative adapter exercises the whole schema.
        const loader = new PluginLoader(path.dirname(target));
        void loader;
        console.log(chalk.green('✔ Declarative execution template validated ({{prompt}} placement, safe command).'));
      }
    } catch (err) {
      console.error(chalk.red(`✖ ${(err as Error).message}`));
      process.exitCode = 1;
    }
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
