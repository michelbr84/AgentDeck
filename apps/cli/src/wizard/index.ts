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
          AgentDeckManager.invalidateVersionCache(adapter.definition.id);
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
  const existingPersonas = await manager.listPersonas();

  const configChoice = await select({
    message: `Configure ${definitionId.toUpperCase()} Agent Instance:`,
    choices: [
      { name: '📋 Choose Persona from Template (Atlas, Sentinel, etc.)', value: 'template' },
      ...(existingPersonas.length > 0
        ? [{ name: `💾 Use Existing Persisted Persona (${existingPersonas.length} saved)`, value: 'existing' }]
        : []),
      { name: '✨ Create Custom Persona (Define Role, Language, Prompt)', value: 'custom' },
    ],
  });

  const instanceName = await input({
    message: 'Enter a display name for this Agent Instance (e.g. "Atlas", "Sentinel", "Claude Senior"):',
    default: `${definitionId.charAt(0).toUpperCase() + definitionId.slice(1)} Assistant`,
  });

  let personaId = '';

  if (configChoice === 'existing') {
    personaId = await select({
      message: 'Select an existing persisted persona:',
      choices: existingPersonas.map((p) => ({
        name: `${p.avatarEmoji || '🤖'} ${p.name} (${p.role}) [${p.language}]`,
        value: p.id,
      })),
    });
  } else if (configChoice === 'custom') {
    const role = await input({
      message: 'Enter agent role/specialty (e.g. "Senior Python Architect"):',
      default: 'General Software Specialist',
    });

    const avatar = await input({
      message: 'Enter an Avatar emoji for this agent:',
      default: '🤖',
    });

    const selectedLang = await select({
      message: 'Choose primary response language for this agent:',
      choices: SUPPORTED_LANGUAGES.map((l) => ({ name: `${l.name} (${l.code})`, value: l.code })),
    });

    const systemPromptOverlay = await input({
      message: 'Enter custom System Prompt Overlay (injected dynamically):\n(Press Enter to accept default)',
      default: 'Always deliver high quality, clear, and well-documented engineering answers.',
    });

    const newPersona = await manager.createPersona({
      name: `${instanceName} Persona`,
      role,
      language: selectedLang,
      systemPromptOverlay,
      avatarEmoji: avatar,
      isTemplate: false,
    });
    personaId = newPersona.id;
  } else {
    // Template selection
    const templateId = await select({
      message: 'Select a base Persona template:',
      choices: INITIAL_PERSONAS.map((p) => ({
        name: `${p.avatarEmoji} ${p.name} — ${p.role}`,
        value: p.id,
      })),
    });

    const tpl = INITIAL_PERSONAS.find((p) => p.id === templateId) || INITIAL_PERSONAS[0]!;

    const role = await input({
      message: `Role for ${instanceName}:`,
      default: tpl.role,
    });

    const selectedLang = await select({
      message: `Choose response language for ${instanceName}:`,
      choices: SUPPORTED_LANGUAGES.map((l) => ({ name: `${l.name} (${l.code})`, value: l.code })),
      default: tpl.language,
    });

    console.log(chalk.dim('\nPress Enter to keep the default prompt, or edit it below:'));
    const systemPromptOverlay = await input({
      message: `System Prompt Overlay for ${tpl.name}:`,
      default: tpl.systemPromptOverlay,
    });

    // Always create a concrete persisted Persona row in SQLite
    const createdPersona = await manager.createPersona({
      name: `${tpl.name} (${instanceName})`,
      role,
      language: selectedLang,
      systemPromptOverlay,
      avatarEmoji: tpl.avatarEmoji,
      isTemplate: false,
    });
    personaId = createdPersona.id;
  }

  // Create the agent instance in SQLite referencing the concrete persisted persona ID
  await manager.createAgentInstance({
    installationId,
    personaId,
    name: instanceName,
    permissionTier: 'developer',
  });

  console.log(chalk.green(`✔ Instance "${instanceName}" successfully configured for ${definitionId}!`));
}
