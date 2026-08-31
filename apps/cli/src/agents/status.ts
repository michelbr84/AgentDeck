/**
 * `agentdeck agents status` — what is installed, and where each agent points.
 */
import chalk from 'chalk';
import { AgentDeckManager, RoutingService } from '@agentdeck/core';
import { isLlmConfigurable } from '@agentdeck/adapter-sdk';

export async function runAgentsStatus(): Promise<void> {
  const manager = await AgentDeckManager.create();
  const routing = new RoutingService(manager.db);

  const deckRouting = await routing.getRouting();
  console.log(chalk.bold('\nRoteamento do deck\n'));
  if (deckRouting) {
    console.log(
      `  primário: ${chalk.cyan(deckRouting.primary.providerId)} / ${deckRouting.primary.model}`
    );
    console.log(
      `  backup:   ${
        deckRouting.backup
          ? `${chalk.cyan(deckRouting.backup.providerId)} / ${deckRouting.backup.model}`
          : chalk.dim('nenhum')
      }`
    );
    // Presence only — the value never leaves the secret store.
    const present = await routing.secretStore.status();
    const creds = Object.entries(present)
      .filter(([, v]) => v)
      .map(([k]) => k);
    console.log(`  credenciais guardadas: ${creds.length ? creds.join(', ') : chalk.dim('nenhuma')}`);
  } else {
    console.log(chalk.dim('  nenhum ainda — rode `agentdeck agents setup`'));
  }

  console.log(chalk.bold('\nAgentes\n'));
  const installations = await manager.scanAndSyncInstallations();
  for (const inst of installations) {
    const adapter = manager.getAdapter(inst.definitionId);
    if (!adapter || !isLlmConfigurable(adapter)) continue;

    const installed = inst.state.installation === 'installed';
    const badge = installed
      ? inst.state.version === 'outdated'
        ? chalk.yellow('▲ desatualizado')
        : chalk.green('✔ instalado')
      : chalk.gray('✖ ausente');

    let live = chalk.dim('—');
    if (installed) {
      const read = await adapter.readLlmConfig();
      live = read.primary
        ? `${read.primary.providerId}/${read.primary.model}`
        : chalk.dim('não configurado');
    }

    const backupNote =
      adapter.llmConfig.backupStrategy === 'native'
        ? chalk.dim('backup nativo')
        : adapter.llmConfig.backupStrategy === 'via-gateway'
          ? chalk.dim('backup via gateway')
          : chalk.dim('sem backup');

    console.log(
      `  ${adapter.definition.name.padEnd(14)} ${badge.padEnd(24)} ${live}  ${backupNote}`
    );
  }
  console.log('');
}
