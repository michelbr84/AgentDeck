/**
 * Cross-adapter conventions for expressing a routing in an agent's own dialect.
 */
import type { ProviderBinding, ProviderId } from '@agentdeck/protocol';

/**
 * Canonical env var per provider.
 *
 * Kept in lockstep with GarraIA's `provider_key_env` table
 * (`crates/garraia-config/src/provider_keys.rs`) so a credential written by one
 * side is found by the other.
 */
export function providerEnvVar(providerId: ProviderId): string | null {
  switch (providerId) {
    case 'openrouter':
      return 'OPENROUTER_API_KEY';
    case 'openai':
      return 'OPENAI_API_KEY';
    case 'anthropic':
      return 'ANTHROPIC_API_KEY';
    default:
      // Ollama and the local gateway need no credential.
      return null;
  }
}

/**
 * OpenClaw addresses models as `<provider>/<model>`, and its own model ids
 * already contain slashes — `openrouter/z-ai/glm-5.3-flash` is correct and not
 * a mistake. Local refs look like `ollama/qwen3.5:2b`.
 */
export function openclawModelRef(binding: ProviderBinding): string {
  const prefix = binding.providerId === 'garraia-gateway' ? 'openai' : binding.providerId;
  return `${prefix}/${binding.model}`;
}

/** Hermes uses the same `<provider>:<model>` shape as its `/model` command. */
export function hermesModelRef(binding: ProviderBinding): string {
  return `${binding.providerId}:${binding.model}`;
}
