import type * as childProcess from 'node:child_process';
import { EventEmitter } from 'node:events';
import type * as os from 'node:os';
import { PassThrough } from 'node:stream';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { spawnAgent } from './spawnAgent';

const spawnCalls: Array<{ env: NodeJS.ProcessEnv }> = [];

vi.mock('node:child_process', async () => {
  const actual = await vi.importActual<typeof childProcess>('node:child_process');
  return {
    ...actual,
    spawn: vi.fn((_command: string, _args: string[], options: { env: NodeJS.ProcessEnv }) => {
      spawnCalls.push({ env: options.env });
      const proc = new EventEmitter() as any;
      proc.stdin = { end: vi.fn(), once: vi.fn(), write: vi.fn(() => true) };
      proc.stdout = new PassThrough();
      proc.stderr = new PassThrough();
      proc.kill = vi.fn();
      proc.pid = 4321;
      return proc;
    }),
  };
});

vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof os>('node:os');
  return { ...actual, platform: vi.fn(() => 'linux') };
});

const spawnClaudeCode = async (env?: Record<string, string>) => {
  const handle = await spawnAgent({
    agentType: 'claude-code',
    env,
    operationId: 'op-preset-env',
    prompt: 'hello',
  });
  handle.kill();
  return spawnCalls.at(-1)!.env;
};

describe('spawnAgent preset env', () => {
  beforeEach(() => {
    spawnCalls.length = 0;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // claude.ai connectors finish connecting after the first model call.
  it('makes Claude Code wait for MCP servers before its first turn', async () => {
    vi.stubEnv('MCP_CONNECTION_NONBLOCKING', undefined);

    const env = await spawnClaudeCode();

    expect(env.MCP_CONNECTION_NONBLOCKING).toBe('false');
  });

  it('lets an agent-configured env override the preset', async () => {
    const env = await spawnClaudeCode({ MCP_CONNECTION_NONBLOCKING: 'true' });

    expect(env.MCP_CONNECTION_NONBLOCKING).toBe('true');
  });

  it('does not apply the Claude Code preset to other agents', async () => {
    vi.stubEnv('MCP_CONNECTION_NONBLOCKING', undefined);

    const handle = await spawnAgent({ agentType: 'codebuddy', operationId: 'op-cb', prompt: 'hi' });
    handle.kill();

    expect(spawnCalls.at(-1)!.env.MCP_CONNECTION_NONBLOCKING).toBeUndefined();
    expect(spawnCalls.at(-1)!.env.CODEBUDDY_CODE_DISABLE_BACKGROUND_TASKS).toBe('1');
  });
});
