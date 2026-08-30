import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(here, '..', 'dist', 'index.js');
const SOURCE = path.resolve(here, '..', 'src', 'mcp-server.ts');

/**
 * Mirrors the self-scanning audit tests on GarraIA's `garra mcp-server`.
 *
 * A single stray write to stdout corrupts the JSON-RPC stream, and the host
 * sees a server that hangs rather than one that misbehaved — which is why this
 * is pinned by a test rather than left to review.
 */
describe('agentdeck mcp-server — stdout discipline', () => {
  it('has no console writes in its source outside the JSON-RPC responder', async () => {
    const source = await fs.readFile(SOURCE, 'utf8');
    const offenders = source
      .split('\n')
      .map((line, i) => ({ line: line.trim(), n: i + 1 }))
      .filter(
        ({ line }) =>
          (line.includes('console.log') || line.includes('console.info')) &&
          !line.startsWith('*') &&
          !line.startsWith('//')
      );
    expect(offenders, `console writes would corrupt the protocol stream`).toEqual([]);
  });

  it('writes to stdout only through the single respond() helper', async () => {
    const source = await fs.readFile(SOURCE, 'utf8');
    const writes = source.match(/process\.stdout\.write/g) ?? [];
    // Exactly one: the body of respond().
    expect(writes).toHaveLength(1);
  });

  it('emits only valid JSON-RPC on stdout across a real handshake', async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), 'agentdeck-mcp-'));
    try {
      const child = spawn(process.execPath, [CLI, 'mcp-server'], {
        env: { ...process.env, HOME: home },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      child.stdout.on('data', (d: Buffer) => (stdout += d.toString()));

      child.stdin.write(
        `${JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 't', version: '1' } },
        })}\n`
      );
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' })}\n`);
      // An unparseable line must be ignored, not answered on stdout.
      child.stdin.write('this is not json\n');
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'nope/nope' })}\n`);

      await new Promise((r) => setTimeout(r, 1500));
      child.stdin.end();
      child.kill();

      const lines = stdout.split('\n').filter((l) => l.trim());
      expect(lines.length).toBeGreaterThanOrEqual(3);

      for (const line of lines) {
        const parsed = JSON.parse(line) as { jsonrpc: string; id?: unknown };
        expect(parsed.jsonrpc).toBe('2.0');
      }

      const byId = new Map(
        lines.map((l) => {
          const d = JSON.parse(l) as { id?: number };
          return [d.id, JSON.parse(l)];
        })
      );
      expect(byId.get(1)?.result?.protocolVersion).toBe('2025-11-25');
      expect(byId.get(2)?.result?.tools?.map((t: { name: string }) => t.name)).toEqual([
        'agentdeck_list_agents',
        'agentdeck_ask',
        'agentdeck_room_post',
        'agentdeck_room_history',
      ]);
      // Unknown method gets a JSON-RPC error, not a crash.
      expect(byId.get(3)?.error?.code).toBe(-32601);
      // The garbage line produced no response at all.
      expect(byId.size).toBe(3);
    } finally {
      await fs.rm(home, { recursive: true, force: true });
    }
  }, 20_000);
});
