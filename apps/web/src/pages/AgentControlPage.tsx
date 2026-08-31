/**
 * Agent Control — the surface for driving every managed agent from one place.
 *
 * Three things live here because they are one decision in the user's head:
 * what is installed, what LLM it points at, and whether that matches the deck
 * default. Splitting them across pages would mean checking three places to
 * answer "is my setup right?".
 */
import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowUpCircle,
  CheckCircle2,
  Download,
  Loader2,
  RefreshCw,
  Zap,
} from 'lucide-react';
import { apiFetch } from '../api';

export interface ProviderBinding {
  providerId: string;
  model: string;
  baseUrl?: string;
  credentialRef?: string;
}

export interface LlmRouting {
  primary: ProviderBinding;
  backup?: ProviderBinding;
  updatedAt: string;
}

interface AgentLlmRow {
  agentId: string;
  name: string;
  configurable: boolean;
  installed?: boolean;
  supportsBackup?: boolean;
  backupStrategy?: 'native' | 'via-gateway' | 'none';
  keyDelivery?: string;
  configFiles?: string[];
  current?: ProviderBinding | null;
  currentBackup?: ProviderBinding | null;
  managedByAgentDeck?: boolean;
  warnings?: string[];
}

interface CatalogEntry {
  id: string;
  label: string;
  summary: string;
  defaultModel: string;
  suggestedModels: { id: string; label: string }[];
  requiresCredential: boolean;
  keyUrl?: string;
}

interface Installation {
  definitionId: string;
  versionInstalled?: string | null;
  versionLatest?: string | null;
  state: {
    installation: string;
    health: string;
    version: string;
    authentication: string;
    runtime: string;
  };
}

type Notify = (type: 'success' | 'error' | 'info', message: string) => void;

export function AgentControlPage({ notify }: { notify: Notify }) {
  const [rows, setRows] = useState<AgentLlmRow[]>([]);
  const [installations, setInstallations] = useState<Installation[]>([]);
  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
  const [routing, setRouting] = useState<LlmRouting | null>(null);
  const [credentials, setCredentials] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  // Draft routing, so editing does not fight the server on every keystroke.
  const [draftPrimary, setDraftPrimary] = useState<ProviderBinding>({
    providerId: 'openrouter',
    model: 'z-ai/glm-5.3-flash',
  });
  const [draftBackup, setDraftBackup] = useState<ProviderBinding | null>({
    providerId: 'ollama',
    model: 'qwen3.5:2b',
  });
  const [keyInput, setKeyInput] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [llm, routingBody, catalogEntries, installationList] = await Promise.all([
        apiFetch<AgentLlmRow[]>('/api/v1/agents/llm'),
        apiFetch<{
          routing: LlmRouting | null;
          credentialPresence: Record<string, boolean>;
        }>('/api/v1/llm-routing'),
        apiFetch<CatalogEntry[]>('/api/v1/providers/catalog'),
        apiFetch<Installation[]>('/api/v1/agents'),
      ]);
      setRows(llm);
      setCatalog(catalogEntries);
      setInstallations(installationList);
      setRouting(routingBody.routing);
      setCredentials(routingBody.credentialPresence ?? {});
      if (routingBody.routing) {
        setDraftPrimary(routingBody.routing.primary);
        setDraftBackup(routingBody.routing.backup ?? null);
      }
    } catch (err) {
      notify('error', `Could not load agent state: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    void load();
  }, [load]);

  const saveRouting = async () => {
    setBusy('routing');
    try {
      if (keyInput.trim()) {
        await apiFetch(`/api/v1/secrets/${draftPrimary.providerId}`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ value: keyInput.trim() }),
        });
        setKeyInput('');
      }

      const body: LlmRouting = {
        primary: {
          ...draftPrimary,
          ...(credentials[draftPrimary.providerId] || keyInput.trim()
            ? { credentialRef: `file:${draftPrimary.providerId}` }
            : {}),
        },
        ...(draftBackup ? { backup: draftBackup } : {}),
        updatedAt: new Date().toISOString(),
      };

      await apiFetch('/api/v1/llm-routing', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      notify('success', 'Routing saved. Apply it to push the change to every agent.');
      await load();
    } catch (err) {
      notify('error', `Could not save routing: ${(err as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const applyToAll = async (dryRun: boolean) => {
    setBusy('apply');
    try {
      const report = await apiFetch<{
        outcomes: { agentName: string; status: string; reason?: string }[];
        partial: boolean;
        runId: string;
      }>('/api/v1/llm-routing/apply', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ dryRun }),
      });

      const applied = report.outcomes.filter((o) => o.status === 'applied').length;
      const failed = report.outcomes.filter((o) => o.status === 'failed');
      if (failed.length > 0) {
        // Name the failure and the undo, rather than a generic "something failed".
        notify(
          'error',
          `${failed[0]?.agentName}: ${failed[0]?.reason ?? 'failed'} — undo with ` +
            `agentdeck agents rollback --run ${report.runId}`
        );
      } else {
        notify(
          'success',
          dryRun
            ? `Dry run OK — ${report.outcomes.length} agent(s) would be updated.`
            : `Applied to ${applied} agent(s).`
        );
      }
      await load();
    } catch (err) {
      notify('error', `Apply failed: ${(err as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const testProvider = async (binding: ProviderBinding) => {
    setBusy(`test-${binding.providerId}`);
    try {
      const result = await apiFetch<{ status: string; message: string }>('/api/v1/providers/test', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(binding),
      });
      notify(result.status === 'ok' ? 'success' : result.status === 'not-found' ? 'error' : 'info', result.message);
    } catch (err) {
      notify('error', `Test failed: ${(err as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const agentAction = async (agentId: string, action: 'install' | 'upgrade' | 'health') => {
    setBusy(`${action}-${agentId}`);
    try {
      const url =
        action === 'health'
          ? `/api/v1/agents/${agentId}/health`
          : `/api/v1/agents/${agentId}/${action}`;
      await apiFetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: action === 'health' ? JSON.stringify({ level: 'level2_connectivity' }) : '{}',
      });
      notify('success', `${agentId}: ${action} completed.`);
      await load();
    } catch (err) {
      notify('error', `${agentId}: ${action} failed — ${(err as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const primaryDescriptor = catalog.find((c) => c.id === draftPrimary.providerId);
  const needsKey =
    primaryDescriptor?.requiresCredential === true && !credentials[draftPrimary.providerId];

  if (loading) {
    return (
      <div className="flex items-center gap-3 text-garra-muted p-8" data-testid="agents-control-loading">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading agent state…
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="page-agent-control">
      {/* ── Deck routing ─────────────────────────────────────────────── */}
      <section className="glass-panel p-6" data-testid="deck-routing-card">
        <header className="flex items-center justify-between mb-1">
          <h2 className="text-lg font-extrabold flex items-center gap-2">
            <Zap className="w-5 h-5 text-garra-primary" /> Deck routing
          </h2>
          <button className="btn-ghost" onClick={() => void load()} data-testid="routing-refresh">
            <RefreshCw className="w-3.5 h-3.5 inline mr-1" /> Refresh
          </button>
        </header>
        <p className="text-sm text-garra-muted mb-5">
          One provider and model for every agent. Individual agents can override it, but that is the
          exception — the point is that they all move together.
        </p>

        <div className="grid gap-5 md:grid-cols-2">
          <BindingEditor
            label="Primary"
            binding={draftPrimary}
            catalog={catalog}
            // The primary is never cleared, so a null from the editor is ignored.
            onChange={(b) => b && setDraftPrimary(b)}
            onTest={() => void testProvider(draftPrimary)}
            testing={busy === `test-${draftPrimary.providerId}`}
            testid="primary"
          />
          <BindingEditor
            label="Backup"
            binding={draftBackup}
            catalog={catalog}
            onChange={setDraftBackup}
            onTest={() => draftBackup && void testProvider(draftBackup)}
            testing={busy === `test-${draftBackup?.providerId}`}
            allowNone
            testid="backup"
          />
        </div>

        {needsKey && (
          <div className="mt-5" data-testid="credential-field">
            <label className="block text-xs font-bold text-garra-muted mb-1.5">
              {primaryDescriptor?.label} API key
              {primaryDescriptor?.keyUrl && (
                <a
                  href={primaryDescriptor.keyUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="ml-2 font-normal text-garra-accent hover:underline"
                >
                  get one →
                </a>
              )}
            </label>
            <input
              type="password"
              className="field mono"
              placeholder="sk-…"
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              data-testid="credential-input"
            />
            <p className="text-xs text-garra-muted-2 mt-1.5">
              Stored at <span className="mono">~/.agentdeck/secrets/</span> with mode 0600 and passed
              to each agent&apos;s own config. It is never shown again — only whether it is set.
            </p>
          </div>
        )}

        {!needsKey && primaryDescriptor?.requiresCredential && (
          <p className="mt-4 text-xs text-garra-success flex items-center gap-1.5" data-testid="credential-present">
            <CheckCircle2 className="w-3.5 h-3.5" />
            {primaryDescriptor.label} credential is stored.
          </p>
        )}

        <div className="flex flex-wrap gap-2.5 mt-6">
          <button
            className="btn-gold"
            onClick={() => void saveRouting()}
            disabled={busy !== null}
            data-testid="routing-save"
          >
            {busy === 'routing' ? 'Saving…' : 'Save routing'}
          </button>
          <button
            className="btn-ghost"
            onClick={() => void applyToAll(true)}
            disabled={busy !== null || !routing}
            data-testid="routing-dry-run"
          >
            Dry run
          </button>
          <button
            className="btn-ghost"
            onClick={() => void applyToAll(false)}
            disabled={busy !== null || !routing}
            data-testid="routing-apply"
          >
            {busy === 'apply' ? 'Applying…' : 'Apply to all agents'}
          </button>
        </div>
      </section>

      {/* ── Per-agent ────────────────────────────────────────────────── */}
      <section className="space-y-3" data-testid="agent-cards">
        {rows
          .filter((r) => r.configurable)
          .map((row) => {
            const inst = installations.find((i) => i.definitionId === row.agentId);
            return (
              <AgentCard
                key={row.agentId}
                row={row}
                installation={inst}
                deckRouting={routing}
                busy={busy}
                onAction={agentAction}
              />
            );
          })}
      </section>
    </div>
  );
}

function BindingEditor({
  label,
  binding,
  catalog,
  onChange,
  onTest,
  testing,
  allowNone,
  testid,
}: {
  label: string;
  binding: ProviderBinding | null;
  catalog: CatalogEntry[];
  onChange: (b: ProviderBinding | null) => void;
  onTest: () => void;
  testing: boolean;
  allowNone?: boolean;
  testid: string;
}) {
  const descriptor = catalog.find((c) => c.id === binding?.providerId);
  return (
    <div data-testid={`binding-${testid}`}>
      <label className="block text-xs font-bold text-garra-muted mb-1.5 uppercase tracking-wide">
        {label}
      </label>
      <select
        className="field mb-2"
        value={binding?.providerId ?? '__none__'}
        onChange={(e) => {
          if (e.target.value === '__none__') return onChange(null);
          const next = catalog.find((c) => c.id === e.target.value);
          onChange({ providerId: e.target.value, model: next?.defaultModel ?? '' });
        }}
        data-testid={`binding-${testid}-provider`}
      >
        {allowNone && <option value="__none__">None — no backup</option>}
        {catalog.map((c) => (
          <option key={c.id} value={c.id}>
            {c.label}
          </option>
        ))}
      </select>

      {binding && (
        <>
          {/* A datalist offers the curated ids while still accepting anything typed. */}
          <input
            className="field mono"
            list={`models-${testid}`}
            value={binding.model}
            onChange={(e) => onChange({ ...binding, model: e.target.value })}
            placeholder="model id"
            data-testid={`binding-${testid}-model`}
          />
          <datalist id={`models-${testid}`}>
            {descriptor?.suggestedModels.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </datalist>
          <button
            className="btn-ghost mt-2"
            onClick={onTest}
            disabled={testing}
            data-testid={`binding-${testid}-test`}
          >
            {testing ? 'Testing…' : 'Test'}
          </button>
        </>
      )}
    </div>
  );
}

function AgentCard({
  row,
  installation,
  deckRouting,
  busy,
  onAction,
}: {
  row: AgentLlmRow;
  installation?: Installation;
  deckRouting: LlmRouting | null;
  busy: string | null;
  onAction: (agentId: string, action: 'install' | 'upgrade' | 'health') => void;
}) {
  const installed = row.installed === true;
  const outdated = installation?.state.version === 'outdated';
  const matchesDeck =
    deckRouting && row.current
      ? row.current.model === deckRouting.primary.model
      : null;

  return (
    <article className="glass-panel p-5" data-testid={`agent-card-${row.agentId}`}>
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-2.5">
          <span
            className={`status-dot ${
              !installed
                ? 'status-dot-offline'
                : outdated
                  ? 'status-dot-warning'
                  : ''
            }`}
          />
          <h3 className="font-extrabold">{row.name}</h3>
          {installation?.versionInstalled && (
            <span className="pill pill-muted mono">v{installation.versionInstalled}</span>
          )}
        </div>

        <div className="flex gap-2">
          {!installed && (
            <button
              className="btn-gold"
              onClick={() => onAction(row.agentId, 'install')}
              disabled={busy !== null}
              data-testid={`agent-${row.agentId}-install`}
            >
              <Download className="w-3.5 h-3.5 inline mr-1" /> Install
            </button>
          )}
          {installed && outdated && (
            <button
              className="btn-gold"
              onClick={() => onAction(row.agentId, 'upgrade')}
              disabled={busy !== null}
              data-testid={`agent-${row.agentId}-upgrade`}
            >
              <ArrowUpCircle className="w-3.5 h-3.5 inline mr-1" /> Upgrade
            </button>
          )}
          {installed && (
            <button
              className="btn-ghost"
              onClick={() => onAction(row.agentId, 'health')}
              disabled={busy !== null}
              data-testid={`agent-${row.agentId}-health`}
            >
              Health
            </button>
          )}
        </div>
      </header>

      {/* The 7-dimension installation state, shown as it really is. */}
      {installation && (
        <div className="flex flex-wrap gap-1.5 mt-3" data-testid={`agent-${row.agentId}-state`}>
          {Object.entries(installation.state).map(([dimension, value]) => (
            <span
              key={dimension}
              className={`pill ${
                ['installed', 'healthy', 'current', 'authenticated', 'available'].includes(String(value))
                  ? 'pill-success'
                  : ['outdated', 'degraded', 'unconfigured'].includes(String(value))
                    ? 'pill-warning'
                    : ['unhealthy', 'error'].includes(String(value))
                      ? 'pill-danger'
                      : 'pill-muted'
              }`}
              title={dimension}
            >
              {String(value)}
            </span>
          ))}
        </div>
      )}

      <dl className="grid gap-x-6 gap-y-1.5 mt-4 text-sm sm:grid-cols-2">
        <div className="flex gap-2">
          <dt className="text-garra-muted">Points at</dt>
          <dd className="mono text-garra-text">
            {row.current ? `${row.current.providerId}/${row.current.model}` : '—'}
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-garra-muted">Backup</dt>
          <dd>
            {/* Never imply a failover the agent cannot actually perform. */}
            {row.backupStrategy === 'native' ? (
              <span className="pill pill-success">native</span>
            ) : row.backupStrategy === 'via-gateway' ? (
              <span className="pill pill-muted">via GarraIA gateway</span>
            ) : (
              <span className="pill pill-warning">not supported</span>
            )}
          </dd>
        </div>
      </dl>

      {matchesDeck === false && (
        <p
          className="mt-3 text-xs flex items-center gap-1.5 text-garra-warning"
          data-testid={`agent-${row.agentId}-drift`}
        >
          <AlertTriangle className="w-3.5 h-3.5" />
          Differs from the deck routing — apply to bring it in line.
        </p>
      )}

      {(row.warnings ?? []).map((w) => (
        <p key={w} className="mt-2 text-xs text-garra-muted flex items-start gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-garra-warning" />
          {w}
        </p>
      ))}

      {row.configFiles && row.configFiles.length > 0 && (
        <p className="mt-3 text-xs text-garra-muted-2 mono break-all">
          {row.configFiles.join(' · ')}
        </p>
      )}
    </article>
  );
}
