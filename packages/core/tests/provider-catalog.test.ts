import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  DEFAULT_BACKUP_MODEL,
  DEFAULT_BACKUP_PROVIDER,
  DEFAULT_PRIMARY_MODEL,
  DEFAULT_PRIMARY_PROVIDER,
  PROVIDER_CATALOG,
  bindingFor,
  describeProvider,
  validateModel,
} from '../src/provider-catalog.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('catalog defaults', () => {
  it('proposes OpenRouter + Ollama with the requested models', () => {
    expect(DEFAULT_PRIMARY_PROVIDER).toBe('openrouter');
    expect(DEFAULT_BACKUP_PROVIDER).toBe('ollama');
    expect(DEFAULT_PRIMARY_MODEL).toBe('z-ai/glm-5.3-flash');
    expect(DEFAULT_BACKUP_MODEL).toBe('qwen3.5:2b');
  });

  it('lists the default model first for each default provider', () => {
    for (const id of [DEFAULT_PRIMARY_PROVIDER, DEFAULT_BACKUP_PROVIDER] as const) {
      const p = describeProvider(id);
      expect(p?.suggestedModels[0]?.id).toBe(p?.defaultModel);
    }
  });

  it('marks local providers as credential-free', () => {
    expect(describeProvider('ollama')?.requiresCredential).toBe(false);
    expect(describeProvider('openrouter')?.requiresCredential).toBe(true);
  });

  it('gives every credential-requiring provider an env var and a key URL', () => {
    for (const p of PROVIDER_CATALOG.filter((x) => x.requiresCredential)) {
      expect(p.envVar, p.id).toBeTruthy();
      expect(p.keyUrl, p.id).toBeTruthy();
    }
  });
});

describe('bindingFor', () => {
  it('fills in the provider base URL', () => {
    expect(bindingFor('openrouter', 'z-ai/glm-5.3-flash')).toEqual({
      providerId: 'openrouter',
      model: 'z-ai/glm-5.3-flash',
      baseUrl: 'https://openrouter.ai/api/v1',
    });
  });

  it('carries a credential reference, never a secret', () => {
    const b = bindingFor('openrouter', 'x', 'file:openrouter');
    expect(b.credentialRef).toBe('file:openrouter');
    expect(JSON.stringify(b)).not.toMatch(/sk-/);
  });
});

describe('validateModel', () => {
  it('confirms an OpenRouter model and reports tool support', async () => {
    vi.stubGlobal('fetch', async () =>
      new Response(
        JSON.stringify({
          data: [{ id: 'z-ai/glm-5.3-flash', supported_parameters: ['tools', 'temperature'] }],
        }),
        { status: 200 }
      )
    );
    const r = await validateModel(bindingFor('openrouter', 'z-ai/glm-5.3-flash'));
    expect(r.status).toBe('ok');
    expect(r.supportsTools).toBe(true);
  });

  it('warns loudly when the model cannot call tools', async () => {
    vi.stubGlobal('fetch', async () =>
      new Response(JSON.stringify({ data: [{ id: 'some/text-only', supported_parameters: [] }] }), {
        status: 200,
      })
    );
    const r = await validateModel(bindingFor('openrouter', 'some/text-only'));
    expect(r.status).toBe('ok');
    expect(r.supportsTools).toBe(false);
    expect(r.message).toMatch(/tool calling/i);
  });

  it('flags a typo before it reaches four config files', async () => {
    vi.stubGlobal('fetch', async () =>
      new Response(JSON.stringify({ data: [{ id: 'z-ai/glm-5.3-flash' }] }), { status: 200 })
    );
    const r = await validateModel(bindingFor('openrouter', 'z-ai/glm-5.3-flsah'));
    expect(r.status).toBe('not-found');
  });

  it('fails open when the provider is unreachable', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new Error('ENOTFOUND');
    });
    const r = await validateModel(bindingFor('openrouter', 'z-ai/glm-5.3-flash'));
    expect(r.status).toBe('unknown');
  });

  it('matches a pulled Ollama tag with and without an explicit tag', async () => {
    vi.stubGlobal('fetch', async () =>
      new Response(JSON.stringify({ models: [{ name: 'qwen3.5:2b' }] }), { status: 200 })
    );
    expect((await validateModel(bindingFor('ollama', 'qwen3.5:2b'))).status).toBe('ok');
    expect((await validateModel(bindingFor('ollama', 'qwen3.5:9b'))).status).toBe('not-found');
  });

  it('tells the user to pull a missing Ollama model', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ models: [] }), { status: 200 }));
    const r = await validateModel(bindingFor('ollama', 'qwen3.5:2b'));
    expect(r.message).toContain('ollama pull qwen3.5:2b');
  });

  it('refuses a non-http(s) Ollama baseUrl without fetching', async () => {
    const spy = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', spy);
    for (const baseUrl of ['file:///etc/passwd', 'ftp://127.0.0.1/x', 'data:application/json,{}']) {
      const r = await validateModel({ providerId: 'ollama', model: 'qwen3.5:2b', baseUrl });
      expect(r.status).toBe('unknown');
      expect(r.message).toMatch(/http/i);
    }
    expect(spy).not.toHaveBeenCalled();
  });
});
