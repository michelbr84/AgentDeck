import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AGENTDECK_VERSION } from '../../packages/shared/src/index.js';
import { createAgentDeckServer } from '../../packages/server/src/index.js';

const currentFile = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFile);
const rootDir = path.resolve(currentDir, '..', '..');

describe('AgentDeck v1.0.4 Version Consistency & Release Metadata Suite', () => {
  it('verifies that canonical AGENTDECK_VERSION is 1.0.4', () => {
    expect(AGENTDECK_VERSION).toBe('1.0.4');
  });

  it('verifies root package.json version matches canonical version 1.0.4', () => {
    const rootPkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf-8'));
    expect(rootPkg.version).toBe('1.0.4');
    expect(rootPkg.version).toBe(AGENTDECK_VERSION);
  });

  it('verifies apps/cli package.json version matches canonical version 1.0.4', () => {
    const cliPkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'apps', 'cli', 'package.json'), 'utf-8'));
    expect(cliPkg.version).toBe('1.0.4');
    expect(cliPkg.version).toBe(AGENTDECK_VERSION);
  });

  it('verifies apps/web package.json version matches canonical version 1.0.4', () => {
    const webPkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'apps', 'web', 'package.json'), 'utf-8'));
    expect(webPkg.version).toBe('1.0.4');
    expect(webPkg.version).toBe(AGENTDECK_VERSION);
  });

  it('verifies scripts/install.sh FALLBACK_VERSION matches v1.0.4', () => {
    const installScript = fs.readFileSync(path.join(rootDir, 'scripts', 'install.sh'), 'utf-8');
    const match = installScript.match(/FALLBACK_VERSION="([^"]+)"/);
    expect(match).not.toBeNull();
    expect(match![1]).toBe('v1.0.4');
    expect(match![1]).toBe(`v${AGENTDECK_VERSION}`);
  });

  it('verifies server /health endpoint reports canonical version 1.0.4', async () => {
    const server = await createAgentDeckServer({ port: 0 });
    const res = await server.inject({
      method: 'GET',
      url: '/health',
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.status).toBe('healthy');
    expect(body.version).toBe('1.0.4');
    expect(body.version).toBe(AGENTDECK_VERSION);
    await server.close();
  });
});
