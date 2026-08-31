/**
 * `agentdeck agents setup` — the one command that provisions every agent.
 *
 * Flow, in the order the user experiences it:
 *   1. Detect what is on the machine.
 *   2. Ask which agents to manage (all four selected by default).
 *   3. Install what is missing, upgrade what is outdated — asking first.
 *   4. Ask for the primary provider, then the backup.
 *   5. Ask for the model on each side, offering a list but accepting anything.
 *   6. Ask for the API key when one is needed, and verify it before storing.
 *   7. Confirm applying the SAME routing everywhere (default yes).
 *      Only if declined does the per-agent override loop run.
 *   8. Apply, then print exactly what happened per agent.
 */
import { checkbox, confirm, input, password, select } from '@inquirer/prompts';
import chalk from 'chalk';
import ora from 'ora';
import {
  AgentDeckManager,
  DEFAULT_BACKUP_MODEL,
  DEFAULT_BACKUP_PROVIDER,
  DEFAULT_PRIMARY_MODEL,
  DEFAULT_PRIMARY_PROVIDER,
  PROVIDER_CATALOG,
  RoutingService,
  bindingFor,
  describeProvider,
  validateModel,
} from '@agentdeck/core';
import { SecretStore } from '@agentdeck/security';
import { isLlmConfigurable, type AgentAdapter } from '@agentdeck/adapter-sdk';
import type { LlmRouting, ProviderBinding, ProviderId } from '@agentdeck/protocol';

/** Agents this command manages by default. */
const DEFAULT_AGENT_IDS = ['garraia', 'hermes', 'openclaw', 'claude-code'];

const TYPE_YOUR_OWN = '__type_your_own__';
const NO_BACKUP = '__no_backup__';

export interface AgentsSetupOptions {
  agents?: string;
  provider?: string;
  model?: string;
  backupProvider?: string;
  backupModel?: string;
  apiKeyStdin?: boolean;
  yes?: boolean;
  dryRun?: boolean;
  perAgent?: boolean;
  force?: boolean;
}

export async function runAgentsSetup(options: AgentsSetupOptions = {}): Promise<void> {
  const interactive = process.stdin.isTTY === true && !options.yes;

  console.log(chalk.bold.cyan('\n╭──────────────────────────────────────────────────────────────╮'));
  console.log(chalk.bold.cyan('│   AgentDeck — provisionamento e roteamento de LLM por agente  │'));
  console.log(chalk.bold.cyan('╰──────────────────────────────────────────────────────────────╯\n'));
  if (options.dryRun) {
    console.log(chalk.yellow('Modo dry-run: nada será escrito em disco.\n'));
  }

  const manager = await AgentDeckManager.create();
  const routingService = new RoutingService(manager.db);

  // ── 1. Detect ──────────────────────────────────────────────────────────────
  const spinner = ora('Procurando agentes instalados nesta máquina...').start();
  const installations = await manager.scanAndSyncInstallations();
  spinner.succeed('Detecção concluída.\n');

  const managed = installations.filter((i) => {
    const adapter = manager.getAdapter(i.definitionId);
    return adapter !== undefined && isLlmConfigurable(adapter);
  });

  for (const inst of managed) {
    const adapter = manager.getAdapter(inst.definitionId);
    const installed = inst.state.installation === 'installed';
    const outdated = inst.state.version === 'outdated';
    const mark = installed
      ? outdated
        ? chalk.yellow('▲ desatualizado')
        : chalk.green('✔ instalado')
      : chalk.gray('✖ não encontrado');
    const ver = inst.versionInstalled ? chalk.dim(` v${inst.versionInstalled}`) : '';
    console.log(`  ${chalk.bold((adapter?.definition.name ?? inst.definitionId).padEnd(14))} ${mark}${ver}`);
  }
  console.log('');

  // ── 2. Which agents ────────────────────────────────────────────────────────
  const requested = options.agents
    ? options.agents.split(',').map((s) => s.trim()).filter(Boolean)
    : null;

  let selectedIds: string[];
  if (requested) {
    selectedIds = requested;
  } else if (interactive) {
    selectedIds = await checkbox({
      message: 'Quais agentes você quer configurar?',
      choices: managed.map((i) => {
        const adapter = manager.getAdapter(i.definitionId);
        return {
          name: `${adapter?.definition.name ?? i.definitionId}`,
          value: i.definitionId,
          // All four ship checked: configuring everything at once is the point.
          checked: DEFAULT_AGENT_IDS.includes(i.definitionId),
        };
      }),
    });
  } else {
    selectedIds = managed
      .map((i) => i.definitionId)
      .filter((id) => DEFAULT_AGENT_IDS.includes(id));
  }

  if (selectedIds.length === 0) {
    console.log(chalk.yellow('Nenhum agente selecionado. Nada a fazer.'));
    return;
  }

  // ── 3. Install / upgrade ───────────────────────────────────────────────────
  for (const id of selectedIds) {
    const adapter = manager.getAdapter(id);
    const inst = managed.find((i) => i.definitionId === id);
    if (!adapter || !inst) continue;

    if (inst.state.installation !== 'installed') {
      const wantInstall = options.yes
        ? true
        : interactive
          ? await confirm({
              message: `${adapter.definition.name} não está instalado. Instalar agora?`,
              default: true,
            })
          : false;
      if (!wantInstall) {
        console.log(chalk.gray(`  → pulando ${adapter.definition.name} (não instalado).`));
        continue;
      }
      if (options.dryRun) {
        console.log(chalk.yellow(`  dry-run: instalaria ${adapter.definition.name}`));
        continue;
      }
      const s = ora(`Instalando ${adapter.definition.name}...`).start();
      try {
        await adapter.install({ onProgress: (stage, pct) => (s.text = `${stage} (${pct ?? 0}%)`) });
        // A fresh install must not inherit a latest-version answer cached
        // before it existed; the next scan looks it up again.
        AgentDeckManager.invalidateVersionCache(adapter.definition.id);
        s.succeed(`${adapter.definition.name} instalado.`);
      } catch (err) {
        s.fail(`Falha ao instalar ${adapter.definition.name}: ${(err as Error).message}`);
      }
    } else if (inst.state.version === 'outdated') {
      const wantUpgrade = options.yes
        ? true
        : interactive
          ? await confirm({
              message: `Há atualização para ${adapter.definition.name} (v${inst.versionInstalled} → v${inst.versionLatest}). Atualizar?`,
              default: true,
            })
          : false;
      if (wantUpgrade && !options.dryRun) {
        const s = ora(`Atualizando ${adapter.definition.name}...`).start();
        const res = await manager.upgradeEngine.executeUpgrade(adapter, {
          onProgress: (stage, pct) => (s.text = `${stage} (${pct ?? 0}%)`),
        });
        if (res.success) s.succeed(`${adapter.definition.name} → v${res.newVersion}`);
        else s.fail(`Falha ao atualizar: ${res.error}`);
      }
    }
  }

  // ── 4/5. Provider + model ──────────────────────────────────────────────────
  console.log('');
  const primary = await pickBinding({
    role: 'primário',
    interactive,
    defaultProvider: (options.provider as ProviderId) ?? DEFAULT_PRIMARY_PROVIDER,
    defaultModel: options.model ?? DEFAULT_PRIMARY_MODEL,
    explicitProvider: options.provider,
    explicitModel: options.model,
    allowNone: false,
  });
  if (!primary) return;

  const backup = await pickBinding({
    role: 'backup',
    interactive,
    defaultProvider: (options.backupProvider as ProviderId) ?? DEFAULT_BACKUP_PROVIDER,
    defaultModel: options.backupModel ?? DEFAULT_BACKUP_MODEL,
    explicitProvider: options.backupProvider,
    explicitModel: options.backupModel,
    allowNone: true,
  });

  // ── 6. Credential ──────────────────────────────────────────────────────────
  const secrets = routingService.secretStore;
  const primaryDescriptor = describeProvider(primary.providerId);
  if (primaryDescriptor?.requiresCredential) {
    const already = await secrets.has(primary.providerId);
    const envFallback = primaryDescriptor.envVar
      ? process.env[primaryDescriptor.envVar]
      : undefined;

    if (!already && !envFallback) {
      let key: string | null = null;
      if (options.apiKeyStdin) {
        key = (await readStdinLine()).trim() || null;
      } else if (interactive) {
        console.log(chalk.dim(`\n  Sem chave ainda? Crie em ${primaryDescriptor.keyUrl}`));
        key =
          (
            await password({
              message: `Cole sua chave da ${primaryDescriptor.label}:`,
              mask: '*',
            })
          ).trim() || null;
      }

      if (!key) {
        console.log(
          chalk.yellow(
            `\n  Sem credencial para ${primaryDescriptor.label}. ` +
              `Defina ${primaryDescriptor.envVar} no ambiente, ou rode de novo e informe a chave.`
          )
        );
      } else {
        const s = ora('Verificando a chave contra o provedor...').start();
        const ok = await verifyCredential(primary.providerId, key);
        if (ok === false) {
          s.fail('O provedor rejeitou essa chave. Nada foi salvo.');
          return;
        }
        s.succeed(ok === true ? 'Chave aceita pelo provedor.' : 'Não deu para verificar agora; salvando mesmo assim.');
        await secrets.set(primary.providerId, key);
      }
    } else if (already) {
      console.log(chalk.dim(`  Reusando a credencial de ${primaryDescriptor.label} já guardada.`));
    }

    if (await secrets.has(primary.providerId)) {
      primary.credentialRef = SecretStore.refFor(primary.providerId);
    }
  }

  // ── Validate the models before writing them into four config files ─────────
  for (const [label, binding] of [
    ['primário', primary],
    ['backup', backup],
  ] as const) {
    if (!binding) continue;
    const s = ora(`Conferindo o modelo ${label}...`).start();
    const v = await validateModel(binding, {
      resolveSecret: () => secrets.get(binding.providerId),
    });
    if (v.status === 'not-found') {
      s.fail(v.message);
      const proceed = interactive
        ? await confirm({ message: 'Gravar mesmo assim?', default: false })
        : false;
      if (!proceed) return;
    } else if (v.status === 'unknown') {
      // Could not check — say so plainly rather than showing a green tick.
      s.info(v.message);
    } else if (v.supportsTools === false) {
      s.warn(v.message);
    } else {
      s.succeed(v.message);
    }
  }

  const routing: LlmRouting = {
    primary,
    ...(backup ? { backup } : {}),
    updatedAt: new Date().toISOString(),
  };

  // ── 7. Apply to all, or per agent ──────────────────────────────────────────
  const adapters = selectedIds
    .map((id) => manager.getAdapter(id))
    .filter((a): a is AgentAdapter => a !== undefined);

  console.log('');
  const applyToAll =
    options.perAgent === true
      ? false
      : options.yes || !interactive
        ? true
        : await confirm({
            message: `Aplicar este mesmo roteamento nos ${adapters.length} agentes selecionados?`,
            default: true,
          });

  await routingService.setRouting(routing);

  if (!applyToAll) {
    console.log(chalk.dim('\n  Configuração individual por agente:\n'));
    for (const adapter of adapters) {
      const useDefault = await confirm({
        message: `${adapter.definition.name}: usar o roteamento padrão (${primary.providerId}/${primary.model})?`,
        default: true,
      });
      if (useDefault) continue;
      const own = await pickBinding({
        role: `primário de ${adapter.definition.name}`,
        interactive: true,
        defaultProvider: primary.providerId,
        defaultModel: primary.model,
        allowNone: false,
      });
      if (own) {
        console.log(chalk.dim(`  → ${adapter.definition.name} usará ${own.providerId}/${own.model}`));
      }
    }
  }

  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const applySpinner = ora('Aplicando o roteamento...').start();
  let report;
  try {
    report = await routingService.applyToAgents(adapters, routing, {
      runId,
      dryRun: options.dryRun ?? false,
      force: options.force ?? false,
      onProgress: (agentId, stage) => (applySpinner.text = `${agentId}: ${stage}`),
    });
    applySpinner.stop();
  } catch (err) {
    applySpinner.fail((err as Error).message);
    process.exitCode = 1;
    return;
  }

  // ── 8. Report ──────────────────────────────────────────────────────────────
  console.log(chalk.bold('\nResultado:\n'));
  for (const o of report.outcomes) {
    const badge =
      o.status === 'applied'
        ? chalk.green('✔ aplicado')
        : o.status === 'already-current'
          ? chalk.dim('= já atual')
          : o.status === 'skipped'
            ? chalk.gray('– pulado')
            : chalk.red('✖ falhou');
    console.log(`  ${o.agentName.padEnd(14)} ${badge}${o.reason ? chalk.dim(`  ${o.reason}`) : ''}`);
    for (const w of o.result?.warnings ?? []) {
      console.log(chalk.yellow(`      ! ${w}`));
    }
    if (options.dryRun) {
      for (const d of o.result?.diff ?? []) {
        console.log(chalk.dim(`      ${d.file}: ${d.key} → ${d.after}`));
      }
    }
  }

  if (report.partial) {
    console.log(
      chalk.yellow(
        `\n  Aplicação parcial. Para desfazer: agentdeck agents rollback --run ${report.runId}`
      )
    );
    process.exitCode = 1;
  } else if (!options.dryRun) {
    console.log(chalk.dim(`\n  Backups desta execução: ${report.backupDir}`));
    console.log(
      `\n  Rode ${chalk.cyan('agentdeck agents link')} para os agentes conseguirem se chamar,\n` +
        `  ou ${chalk.cyan('agentdeck web')} para abrir o painel.\n`
    );
  }
}

// ── helpers ──────────────────────────────────────────────────────────────────

interface PickBindingArgs {
  role: string;
  interactive: boolean;
  defaultProvider: ProviderId;
  defaultModel: string;
  explicitProvider?: string | undefined;
  explicitModel?: string | undefined;
  allowNone: boolean;
}

/** Asks for a provider and then a model, always allowing a free-typed model. */
async function pickBinding(args: PickBindingArgs): Promise<ProviderBinding | null> {
  if (!args.interactive || args.explicitProvider) {
    const providerId = (args.explicitProvider ?? args.defaultProvider) as ProviderId;
    return bindingFor(providerId, args.explicitModel ?? args.defaultModel);
  }

  const providerChoice = await select<ProviderId | typeof NO_BACKUP>({
    message: `Provedor ${args.role}:`,
    default: args.defaultProvider,
    choices: [
      ...PROVIDER_CATALOG.map((p) => ({
        name: `${p.label} — ${p.summary}`,
        value: p.id as ProviderId | typeof NO_BACKUP,
      })),
      ...(args.allowNone
        ? [{ name: 'Nenhum — sem backup', value: NO_BACKUP as ProviderId | typeof NO_BACKUP }]
        : []),
    ],
  });
  if (providerChoice === NO_BACKUP) return null;

  const descriptor = describeProvider(providerChoice);
  const suggested = descriptor?.suggestedModels ?? [];
  const modelChoice = await select<string>({
    message: `Modelo ${args.role} (${descriptor?.label ?? providerChoice}):`,
    default: descriptor?.defaultModel,
    choices: [
      ...suggested.map((m) => ({ name: `${m.id} — ${m.label}`, value: m.id })),
      { name: '✍️  digitar outro modelo...', value: TYPE_YOUR_OWN },
    ],
  });

  const model =
    modelChoice === TYPE_YOUR_OWN
      ? (
          await input({
            message: `Id do modelo ${args.role}:`,
            default: descriptor?.defaultModel ?? '',
          })
        ).trim()
      : modelChoice;

  if (!model) return null;
  return bindingFor(providerChoice, model);
}

/** Reads one line from stdin, for `--api-key-stdin`. */
async function readStdinLine(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8').split('\n')[0] ?? '';
}

/**
 * Checks a credential against the provider.
 *
 * `true` accepted, `false` explicitly rejected, `null` could not tell. Only an
 * explicit rejection aborts — a network blip must not block setup.
 */
async function verifyCredential(providerId: ProviderId, key: string): Promise<boolean | null> {
  const endpoints: Partial<Record<ProviderId, string>> = {
    openrouter: 'https://openrouter.ai/api/v1/key',
    openai: 'https://api.openai.com/v1/models',
  };
  const url = endpoints[providerId];
  if (!url) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(url, {
      headers: { authorization: `Bearer ${key}` },
      signal: controller.signal,
    });
    if (res.status === 401 || res.status === 403) return false;
    return res.ok ? true : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
