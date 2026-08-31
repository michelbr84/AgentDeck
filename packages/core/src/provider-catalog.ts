/**
 * What a user can pick as a provider + model, and how we check the pick is real.
 *
 * The curated lists are a convenience, never a constraint: every provider
 * accepts a free-typed model id. What matters more than the list is
 * `validateModel` — a typo'd model id written into four agent configs fails at
 * the agent's first request, far from the wizard that caused it.
 */
import type { ProviderBinding, ProviderId } from '@agentdeck/protocol';

export interface ProviderDescriptor {
  id: ProviderId;
  label: string;
  /** Human hint shown next to the choice. */
  summary: string;
  /** Default model when the user just presses Enter. */
  defaultModel: string;
  /** A few well-known models; the user may always type another. */
  suggestedModels: { id: string; label: string }[];
  baseUrl?: string;
  /** Canonical env var, matching GarraIA's `provider_key_env` table. */
  envVar?: string;
  /** False for local providers that need no credential. */
  requiresCredential: boolean;
  keyUrl?: string;
}

/** The system defaults the setup wizard proposes: OpenRouter primary, Ollama backup. */
export const DEFAULT_PRIMARY_PROVIDER: ProviderId = 'openrouter';
export const DEFAULT_BACKUP_PROVIDER: ProviderId = 'ollama';
export const DEFAULT_PRIMARY_MODEL = 'z-ai/glm-5.3-flash';
export const DEFAULT_BACKUP_MODEL = 'qwen3.5:2b';

export const PROVIDER_CATALOG: ProviderDescriptor[] = [
  {
    id: 'openrouter',
    label: 'OpenRouter',
    summary: 'One key, hundreds of models — recommended default',
    defaultModel: DEFAULT_PRIMARY_MODEL,
    suggestedModels: [
      { id: 'z-ai/glm-5.3-flash', label: 'GLM 5.3 Flash — fast, cheap, tool-capable' },
      { id: 'anthropic/claude-sonnet-4.5', label: 'Claude Sonnet 4.5' },
      { id: 'openai/gpt-4o', label: 'GPT-4o' },
      { id: 'openrouter/auto', label: 'Auto — let OpenRouter choose' },
    ],
    baseUrl: 'https://openrouter.ai/api/v1',
    envVar: 'OPENROUTER_API_KEY',
    requiresCredential: true,
    keyUrl: 'https://openrouter.ai/keys',
  },
  {
    id: 'ollama',
    label: 'Ollama (local)',
    summary: 'Runs on this machine — no key, no per-token cost',
    defaultModel: DEFAULT_BACKUP_MODEL,
    suggestedModels: [
      { id: 'qwen3.5:2b', label: 'Qwen 3.5 2B — small, fast fallback' },
      { id: 'qwen3.8:latest', label: 'Qwen 3.8 — GarraIA default' },
      { id: 'llama3.1', label: 'Llama 3.1' },
    ],
    baseUrl: 'http://127.0.0.1:11434/v1',
    requiresCredential: false,
  },
  {
    id: 'openai',
    label: 'OpenAI',
    summary: 'GPT models direct from OpenAI',
    defaultModel: 'gpt-4o',
    suggestedModels: [
      { id: 'gpt-4o', label: 'GPT-4o' },
      { id: 'gpt-4o-mini', label: 'GPT-4o mini' },
    ],
    envVar: 'OPENAI_API_KEY',
    requiresCredential: true,
    keyUrl: 'https://platform.openai.com/api-keys',
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    summary: 'Claude models direct from Anthropic',
    defaultModel: 'claude-sonnet-4-5-20250929',
    suggestedModels: [
      { id: 'claude-sonnet-4-5-20250929', label: 'Claude Sonnet 4.5' },
      { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
    ],
    envVar: 'ANTHROPIC_API_KEY',
    requiresCredential: true,
    keyUrl: 'https://console.anthropic.com/settings/keys',
  },
  {
    id: 'garraia-gateway',
    label: 'GarraIA gateway (local)',
    summary: 'Route through the local gateway — it holds the key and does the failover',
    defaultModel: DEFAULT_PRIMARY_MODEL,
    suggestedModels: [],
    baseUrl: 'http://127.0.0.1:3888',
    requiresCredential: false,
  },
];

export function describeProvider(id: ProviderId): ProviderDescriptor | undefined {
  return PROVIDER_CATALOG.find((p) => p.id === id);
}

/** Builds a binding with the provider's default base URL filled in. */
export function bindingFor(
  providerId: ProviderId,
  model: string,
  credentialRef?: string
): ProviderBinding {
  const descriptor = describeProvider(providerId);
  return {
    providerId,
    model,
    ...(descriptor?.baseUrl ? { baseUrl: descriptor.baseUrl } : {}),
    ...(credentialRef ? { credentialRef } : {}),
  };
}

export interface ModelValidation {
  /** `unknown` means we could not reach the provider, NOT that the model is bad. */
  status: 'ok' | 'not-found' | 'unknown';
  message: string;
  /** True when the provider advertises function calling for this model. */
  supportsTools?: boolean;
}

/**
 * Checks a model id against the live provider before we write it anywhere.
 *
 * Deliberately fails *open*: an unreachable provider yields `unknown`, and the
 * caller proceeds with a warning. Blocking setup because GitHub or OpenRouter
 * is having a bad minute would be worse than the typo we are guarding against.
 */
export async function validateModel(
  binding: ProviderBinding,
  opts: { timeoutMs?: number; resolveSecret?: () => Promise<string | null> } = {}
): Promise<ModelValidation> {
  const timeoutMs = opts.timeoutMs ?? 8000;

  if (binding.providerId === 'openrouter') {
    const models = await fetchJson<{ data?: { id: string; supported_parameters?: string[] }[] }>(
      'https://openrouter.ai/api/v1/models',
      timeoutMs
    );
    if (!models?.data) {
      return { status: 'unknown', message: 'Could not reach OpenRouter to verify the model.' };
    }
    const hit = models.data.find((m) => m.id === binding.model);
    if (!hit) {
      return {
        status: 'not-found',
        message: `OpenRouter does not list "${binding.model}".`,
      };
    }
    const supportsTools = (hit.supported_parameters ?? []).includes('tools');
    return {
      status: 'ok',
      supportsTools,
      message: supportsTools
        ? `"${binding.model}" is available and supports tool calling.`
        : `"${binding.model}" is available but does NOT advertise tool calling — ` +
          'agents that rely on tools (Claude Code especially) will not work well with it.',
    };
  }

  if (binding.providerId === 'ollama') {
    const base = (binding.baseUrl ?? 'http://127.0.0.1:11434/v1').replace(/\/v1\/?$/, '');
    const tags = await fetchJson<{ models?: { name: string }[] }>(`${base}/api/tags`, timeoutMs);
    if (!tags?.models) {
      return {
        status: 'unknown',
        message: 'Ollama is not reachable — start it, or run `ollama pull` before first use.',
      };
    }
    // `qwen3.5:2b` and `qwen3.5` should both match a pulled `qwen3.5:2b`.
    const wanted = binding.model.includes(':') ? binding.model : `${binding.model}:latest`;
    const found = tags.models.some((m) => m.name === wanted || m.name === binding.model);
    return found
      ? { status: 'ok', message: `"${binding.model}" is pulled locally.` }
      : {
          status: 'not-found',
          message: `Ollama does not have "${binding.model}" yet — run \`ollama pull ${binding.model}\`.`,
        };
  }

  return { status: 'unknown', message: 'No live catalog for this provider; skipping validation.' };
}

async function fetchJson<T>(url: string, timeoutMs: number): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
