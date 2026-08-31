/**
 * `agentdeck agents rollback` — the explicit undo for a routing apply.
 *
 * Exists because `applyToAgents` deliberately does NOT auto-revert a partial
 * success: an automatic revert can itself fail and leave a worse state than it
 * found, and a partial apply is often still what the user wants. So the undo is
 * a separate, deliberate command.
 */
import chalk from 'chalk';
import { AgentDeckManager, RoutingService } from '@agentdeck/core';
import type { AgentAdapter } from '@agentdeck/adapter-sdk';

export interface RollbackOptions {
  run?: string;
  agent?: string;
}

export async function runAgentsRollback(options: RollbackOptions = {}): Promise<void> {
  const manager = await AgentDeckManager.create();
  const routing = new RoutingService(manager.db);

  const runs = await routing.listRuns();
  if (runs.length === 0) {
    console.log(chalk.yellow('Nenhuma execução de roteamento com backup encontrada.'));
    return;
  }

  if (!options.run) {
    console.log(chalk.bold('\nExecuções disponíveis para rollback:\n'));
    for (const r of runs) {
      console.log(`  ${chalk.cyan(r.runId)}  ${chalk.dim(r.createdAt)}`);
    }
    console.log(
      `\n  Use ${chalk.cyan('agentdeck agents rollback --run <id>')} para restaurar.\n`
    );
    return;
  }

  const adapters: AgentAdapter[] = manager.getAllAdapters();
  const results = await routing.rollbackRun(options.run, adapters, options.agent);

  console.log(chalk.bold(`\nRollback de ${options.run}:\n`));
  let failed = false;
  for (const r of results) {
    if (r.restored) {
      const detail = [
        r.restoredFiles.length ? `${r.restoredFiles.length} restaurado(s)` : '',
        r.removedFiles.length ? `${r.removedFiles.length} removido(s)` : '',
      ]
        .filter(Boolean)
        .join(', ');
      console.log(`  ${r.agentId.padEnd(14)} ${chalk.green('✔')} ${chalk.dim(detail)}`);
    } else if (r.reason?.startsWith('nothing to restore')) {
      // Not a failure — there was simply no prior config to bring back.
      console.log(`  ${r.agentId.padEnd(14)} ${chalk.dim('– nada a restaurar')}`);
    } else {
      failed = true;
      console.log(`  ${r.agentId.padEnd(14)} ${chalk.red('✖ falhou')} ${chalk.dim(r.reason ?? '')}`);
    }
  }
  console.log('');
  if (failed) process.exitCode = 1;
}
