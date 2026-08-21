import { input, select, confirm } from '@inquirer/prompts';
import chalk from 'chalk';
import ora from 'ora';
import { AgentDeckManager } from '@agentdeck/core';
import { SUPPORTED_LANGUAGES, INITIAL_PERSONAS } from '@agentdeck/shared';

export interface SetupOptions {
  mode?: 'wizard' | 'add' | 'edit';
  targetName?: string;
}

export async function runSetupWizard(options?: SetupOptions): Promise<void> {
  const manager = await AgentDeckManager.create();

  console.log(chalk.bold.cyan('\n╭─────────────────────────────────────────────────────────────╮'));
  console.log(chalk.bold.cyan(`│       AgentDeck Interactive Setup & Agent Configurator      │`));
  console.log(chalk.bold.cyan('╰─────────────────────────────────────────────────────────────╯\n'));
  if (options?.mode) {
    console.log(chalk.dim(`Mode: ${options.mode}${options.targetName ? ` (${options.targetName})` : ''}\n`));
  }

  const spinner = ora('Detecting installed local agent runtimes...').start();
  const installations = await manager.scanAndSyncInstallations();
  spinner.succeed('Agent detection completed.');

  console.log('\nDetected Agents:');
  for (const inst of installations) {
    const isInstalled = inst.state.installation === 'installed';
    const mark = isInstalled ? chalk.green('✔ Installed') : chalk.gray('✖ Not Found');
    const ver = inst.versionInstalled ? ` (v${inst.versionInstalled})` : '';
    console.log(`  ${chalk.bold(inst.definitionId.padEnd(14))} ${mark}${ver}`);
  }
  console.log('');

  // Ask one by one if not installed or if user wants to add/configure
  for (const inst of installations) {
    const adapter = manager.getAdapter(inst.definitionId);
    if (!adapter) continue;

    const isInstalled = inst.state.installation === 'installed';

    if (!isInstalled) {
      const wantInstall = await confirm({
        message: `Agent "${adapter.definition.name}" (${adapter.definition.id}) is not installed. Do you want to install it now?`,
        default: false,
      });

      if (wantInstall) {
        const installSpinner = ora(`Installing ${adapter.definition.name}...`).start();
        try {
          await adapter.install({
            onProgress: (stage, pct) => {
              installSpinner.text = `Installing ${adapter.definition.name}: ${stage} (${pct || 0}%)`;
            },
          });
          installSpinner.succeed(`${adapter.definition.name} installed successfully!`);
        } catch (err) {
          installSpinner.fail(`Failed to install ${adapter.definition.name}: ${(err as Error).message}`);
        }
      }
    } else {
      // If already installed, check for updates
      const latest = await adapter.getLatestVersion();
      if (inst.versionInstalled && latest.latestVersion && inst.versionInstalled !== latest.latestVersion) {
        console.log(
          chalk.yellow(`\n▲ An update is available for ${adapter.definition.name}: ${inst.versionInstalled} -> ${latest.latestVersion}`)
        );
        const doUpgrade = await confirm({
          message: `Would you like to upgrade ${adapter.definition.name} before configuring?`,
          default: true,
        });

        if (doUpgrade) {
          const upSpinner = ora(`Upgrading ${adapter.definition.name}...`).start();
          const upResult = await manager.upgradeEngine.executeUpgrade(adapter, {
            onProgress: (stage, pct) => {
              upSpinner.text = `Upgrading: ${stage} (${pct || 0}%)`;
            },
          });

          if (upResult.success) {
            upSpinner.succeed(`Upgraded ${adapter.definition.name} to v${upResult.newVersion}!`);
          } else {
            upSpinner.fail(`Upgrade failed: ${upResult.error}`);
          }
        }
      }

      // Ask if user wants to configure a persona/instance for this agent
      const wantConfigure = await confirm({
        message: `Configure a new or existing persona for ${adapter.definition.name}?`,
        default: true,
      });

      if (wantConfigure) {
        await configurePersonaForAgent(manager, inst.id, adapter.definition.id);
      }
    }
  }

  console.log(chalk.bold.green('\n✔ Setup and configuration wizard finished!'));
  console.log(`Run ${chalk.cyan('agentdeck status')} to view configured instances or ${chalk.cyan('agentdeck tui')} to start the UI.\n`);
}

async function configurePersonaForAgent(
  manager: AgentDeckManager,
  installationId: string,
  definitionId: string
): Promise<void> {
  const instanceName = await input({
    message: 'Enter a name for this Agent Instance (e.g. "Atlas", "Sentinel", "Claude Senior"):',
    default: `${definitionId.charAt(0).toUpperCase() + definitionId.slice(1)} Assistant`,
  });

  const personaTemplate = await select({
    message: 'Select a base Persona template or create a custom one:',
    choices: [
      ...INITIAL_PERSONAS.map((p) => ({
        name: `${p.avatarEmoji} ${p.name} (${p.role})`,
        value: p.id,
      })),
      { name: '✨ Custom Persona (define your own role and system prompt)', value: 'custom' },
    ],
  });

  let personaId = personaTemplate;
  let selectedLang = 'pt-BR';
  let systemPromptOverlay = '';
  let avatar = '🤖';
  let role = 'Software Assistant';

  if (personaTemplate === 'custom') {
    role = await input({
      message: 'Enter agent role/specialty (e.g. "Senior Python Architect"):',
      default: 'General Software Specialist',
    });

    avatar = await input({
      message: 'Enter an Avatar emoji for this agent:',
      default: '🤖',
    });

    selectedLang = await select({
      message: 'Choose primary response language for this agent:',
      choices: SUPPORTED_LANGUAGES.map((l) => ({ name: `${l.name} (${l.code})`, value: l.code })),
    });

    systemPromptOverlay = await input({
      message: 'Enter custom System Prompt Overlay (injected dynamically):',
      default: 'Always deliver high quality, clear, and well-documented engineering answers.',
    });

    const newPersona = await manager.createPersona({
      name: instanceName,
      role,
      language: selectedLang,
      systemPromptOverlay,
      avatarEmoji: avatar,
      isTemplate: false,
    });
    personaId = newPersona.id;
  } else {
    // Look up template and ask if user wants to customize language
    const tpl = INITIAL_PERSONAS.find((p) => p.id === personaTemplate);
    if (tpl) {
      selectedLang = await select({
        message: `Choose response language for ${tpl.name}:`,
        choices: SUPPORTED_LANGUAGES.map((l) => ({ name: `${l.name} (${l.code})`, value: l.code })),
        default: tpl.language,
      });

      const editPrompt = await confirm({
        message: `Edit the default system prompt overlay for ${tpl.name}?`,
        default: false,
      });

      if (editPrompt) {
        systemPromptOverlay = await input({
          message: 'System prompt overlay:',
          default: tpl.systemPromptOverlay,
        });

        const created = await manager.createPersona({
          name: `${tpl.name} (${instanceName})`,
          role: tpl.role,
          language: selectedLang,
          systemPromptOverlay,
          avatarEmoji: tpl.avatarEmoji,
          isTemplate: false,
        });
        personaId = created.id;
      }
    }
  }

  // Create the agent instance in SQLite
  await manager.createAgentInstance({
    installationId,
    personaId,
    name: instanceName,
    permissionTier: 'developer',
  });

  console.log(chalk.green(`✔ Instance "${instanceName}" successfully configured for ${definitionId}!`));
}
