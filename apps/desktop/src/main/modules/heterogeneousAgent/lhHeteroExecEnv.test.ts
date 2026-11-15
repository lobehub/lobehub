import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildLhHeteroExecEnv, buildLhHeteroExecInvocation } from './lhHeteroExecEnv';

vi.mock('@/modules/cliEmbedding', () => ({
  withEmbeddedCliEnv: (env: NodeJS.ProcessEnv) => env,
}));

// A resumed session, so the prompt carries no first-turn introduction.
const invocation = {
  agentType: 'opencode',
  operationId: 'op-1',
  prompt: 'inspect the repository',
  resumeSessionId: 'session-1',
  topicId: 'topic-1',
  workDir: '/repo',
};

describe('buildLhHeteroExecEnv', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("drops the shell's Anthropic credentials so the CLI keeps its own login", () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-shell-key');
    vi.stubEnv('ANTHROPIC_BASE_URL', 'https://shell.example.com');

    const env = buildLhHeteroExecEnv({
      jwt: 'jwt',
      operationId: 'op-1',
      proxyEnv: {},
      serverUrl: 'https://server.example.com',
      topicId: 'topic-1',
    });

    expect(env).not.toHaveProperty('ANTHROPIC_API_KEY');
    expect(env).not.toHaveProperty('ANTHROPIC_BASE_URL');
    expect(env).toMatchObject({ LOBEHUB_JWT: 'jwt', LOBEHUB_OPERATION_ID: 'op-1' });
  });
});

describe('buildLhHeteroExecInvocation', () => {
  it("passes the agent's own command and carries its env in the stdin envelope", () => {
    const { args, stdinPayload } = buildLhHeteroExecInvocation({
      ...invocation,
      agentCommand: ' /opt/bin/opencode ',
      agentEnv: { OPENCODE_CONFIG: '/custom/opencode.json' },
      extraArgs: ['--model', 'm'],
    });

    expect(args.slice(args.indexOf('--resume'))).toEqual([
      '--resume',
      'session-1',
      '--command',
      '/opt/bin/opencode',
      '--model',
      'm',
    ]);
    expect(JSON.parse(stdinPayload)).toEqual({
      agentEnv: { OPENCODE_CONFIG: '/custom/opencode.json' },
      content: [{ text: 'inspect the repository', type: 'text' }],
    });
  });

  it('leaves the default command and a plain prompt untouched', () => {
    const { args, stdinPayload } = buildLhHeteroExecInvocation({
      ...invocation,
      agentCommand: ' ',
    });

    expect(args).not.toContain('--command');
    expect(stdinPayload).toBe(JSON.stringify('inspect the repository'));
  });
});
