import { describe, it, expect } from 'vitest';
import { executeSafeCommand } from '../src/process-executor.js';

describe('Process Executor & Stdin Transport', () => {
  it('executes safe commands without shell', async () => {
    const result = await executeSafeCommand({
      command: 'node',
      args: ['-e', { value: 'console.log("hello safe command")', type: 'opaque-user-content' }],
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('hello safe command');
  });

  it('passes multiline content safely via stdin stream', async () => {
    const multiline = 'Line 1\nLine 2\nLine with "quotes" and $variables';
    const result = await executeSafeCommand({
      command: 'node',
      args: ['-e', { value: 'process.stdin.setEncoding("utf8"); let d=""; process.stdin.on("data", c => d+=c); process.stdin.on("end", () => console.log(d));', type: 'opaque-user-content' }],
      stdin: multiline,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe(multiline);
  });

  it('captures exit code and separates stdout from stderr', async () => {
    const result = await executeSafeCommand({
      command: 'node',
      args: ['-e', { value: 'console.log("stdout message"); console.error("stderr diagnostic"); process.exit(1);', type: 'opaque-user-content' }],
    });

    expect(result.exitCode).toBe(1);
    expect(result.stdout.trim()).toBe('stdout message');
    expect(result.stderr.trim()).toBe('stderr diagnostic');
  });
});
