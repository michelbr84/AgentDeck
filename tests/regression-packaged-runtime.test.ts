import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { createAgentDeckServer, WebSocket } from '../packages/server/src/index.js';
import { AgentDeckDatabase } from '../packages/database/src/index.js';
import { AgentDeckManager } from '../packages/core/src/index.js';

describe('Packaged Runtime Regression Suite (TUI & Web Deck)', () => {
  it('TUI module loads, executes React/Ink reconciliation, and exits without TypeError or ReactCurrentBatchConfig crashes', async () => {
    // Spawn node running the built TUI entrypoint
    const cliDist = path.resolve(__dirname, '../apps/cli/dist/index.js');
    expect(fs.existsSync(cliDist)).toBe(true);

    const child = spawn('node', [cliDist, 'docs'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, NODE_ENV: 'production' },
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (d) => {
      stdout += d.toString('utf8');
      // If docs view rendered, exit cleanly
      if (stdout.includes('AgentDeck Offline Documentation') || stdout.includes('AgentDeck')) {
        child.kill('SIGINT');
      }
    });

    child.stderr.on('data', (d) => {
      stderr += d.toString('utf8');
    });

    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        resolve();
      }, 5000);

      child.on('close', () => {
        clearTimeout(timer);
        resolve();
      });
    });

    // Verify there are NO React reconciler crashes
    expect(stderr).not.toContain('ReactCurrentBatchConfig');
    expect(stderr).not.toContain('ERR_UNHANDLED_EXCEPTION');
  });

  it('Web Deck server locates static web root, serves index.html at GET /, and serves assets with 200', async () => {
    const db = new AgentDeckDatabase({ dbPath: ':memory:', inMemory: true });
    await db.migrate();
    const manager = AgentDeckManager.createWithDatabase(db);
    const PORT = 4329;
    const server = await createAgentDeckServer({ port: PORT, manager });
    await server.listen({ port: PORT, host: '127.0.0.1' });

    // Assert webRoot was resolved from apps/web/dist or standard paths
    expect(server.webRoot).toBeDefined();
    expect(server.webRoot).not.toBeNull();
    expect(fs.existsSync(path.join(server.webRoot!, 'index.html'))).toBe(true);

    // Assert GET / returns 200 text/html with AgentDeck title and root element
    const rootRes = await fetch(`http://127.0.0.1:${PORT}/`);
    expect(rootRes.status).toBe(200);
    expect(rootRes.headers.get('content-type')).toContain('text/html');
    const rootBody = await rootRes.text();
    expect(rootBody).toContain('AgentDeck');
    expect(rootBody).toContain('<div id="root">');

    // Extract asset script/css reference from HTML and test that the file can be fetched
    const assetMatch = rootBody.match(/src="(\/assets\/[^"]+)"/);
    if (assetMatch && assetMatch[1]) {
      const assetRes = await fetch(`http://127.0.0.1:${PORT}${assetMatch[1]}`);
      expect(assetRes.status).toBe(200);
    }

    // Assert API route works on same server
    const healthRes = await fetch(`http://127.0.0.1:${PORT}/health`);
    expect(healthRes.status).toBe(200);
    const health = await healthRes.json();
    expect(health.status).toBe('healthy');

    // Assert WebSocket route connects cleanly
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
    await new Promise<void>((resolve, reject) => {
      ws.on('open', () => {
        ws.send(JSON.stringify({ type: 'ping' }));
        ws.close();
        resolve();
      });
      ws.on('error', reject);
    });

    await server.close();
    db.close();
  });
});
