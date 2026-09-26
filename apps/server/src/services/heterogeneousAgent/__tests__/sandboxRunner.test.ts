import { lobeHubCliGuide } from '@lobechat/heterogeneous-agents/protocol';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { sandboxEnv } from '@/envs/sandbox';

import { spawnHeteroSandbox } from '../sandboxRunner';

/** The prompt rides into the sandbox base64-encoded — decode it back out. */
const decodeStdinPayload = (command: string): string => {
  const encoded = command.match(/^echo '([^']+)' \| base64 -d/)?.[1];
  if (!encoded) throw new Error(`No base64 stdin payload in command: ${command}`);
  return Buffer.from(encoded, 'base64').toString('utf8');
};

const { mockCallTool } = vi.hoisted(() => ({
  mockCallTool: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock('@/envs/app', () => ({
  appEnv: { APP_URL: 'https://app.example.com' },
}));

vi.mock('@/envs/sandbox', () => ({
  sandboxEnv: { HETERO_SANDBOX_FORWARD_ENV: undefined },
}));

const forwardEnv = (value: string | undefined) => {
  (sandboxEnv as { HETERO_SANDBOX_FORWARD_ENV?: string }).HETERO_SANDBOX_FORWARD_ENV = value;
};

vi.mock('@/server/services/sandbox', () => ({
  createSandboxService: vi.fn(() => ({
    callTool: mockCallTool,
  })),
}));

describe('spawnHeteroSandbox', () => {
  beforeEach(() => {
    mockCallTool.mockClear();
    mockCallTool.mockResolvedValue({ success: true });
  });

  it('forwards resolved selector args to lh hetero exec', async () => {
    await spawnHeteroSandbox({
      agentType: 'claude-code',
      args: ['--model', 'opus', '--effort', 'high'],
      assistantMessageId: 'msg-1',
      jwt: 'jwt',
      marketService: {} as any,
      operationId: 'op-1',
      prompt: 'hi',
      topicId: 'topic-1',
      userId: 'user-1',
    });

    expect(mockCallTool).toHaveBeenCalledWith(
      'runCommand',
      expect.objectContaining({
        command: expect.stringContaining("'--model' 'opus' '--effort' 'high'"),
      }),
    );
  });

  it('shell-escapes selector args before interpolating the sandbox command', async () => {
    await spawnHeteroSandbox({
      agentType: 'claude-code',
      args: ['--model', '$(touch /tmp/pwned)', '--effort', "hi'there"],
      assistantMessageId: 'msg-1',
      jwt: 'jwt',
      marketService: {} as any,
      operationId: 'op-1',
      prompt: 'hi',
      topicId: 'topic-1',
      userId: 'user-1',
    });

    const command = mockCallTool.mock.calls[0][1].command;
    expect(command).toContain("'$(touch /tmp/pwned)'");
    expect(command).toContain("'hi'\\''there'");
    expect(command).not.toContain('"$(touch /tmp/pwned)"');
  });

  it('introduces the LobeHub CLI to a run that starts a new session', async () => {
    await spawnHeteroSandbox({
      agentType: 'claude-code',
      assistantMessageId: 'msg-1',
      jwt: 'jwt',
      marketService: {} as any,
      operationId: 'op-1',
      prompt: 'hi',
      topicId: 'topic-1',
      userId: 'user-1',
    });

    const payload = JSON.parse(decodeStdinPayload(mockCallTool.mock.calls[0][1].command));
    expect(payload).toEqual([
      { text: lobeHubCliGuide, type: 'text' },
      { text: 'hi', type: 'text' },
    ]);
  });

  it('does not repeat the CLI introduction on a resumed session', async () => {
    await spawnHeteroSandbox({
      agentType: 'claude-code',
      assistantMessageId: 'msg-1',
      jwt: 'jwt',
      marketService: {} as any,
      operationId: 'op-1',
      prompt: 'hi',
      resumeSessionId: 'session-1',
      topicId: 'topic-1',
      userId: 'user-1',
    });

    expect(JSON.parse(decodeStdinPayload(mockCallTool.mock.calls[0][1].command))).toBe('hi');
  });

  it('injects LOBEHUB_WORKSPACE_ID when the topic belongs to a workspace', async () => {
    await spawnHeteroSandbox({
      agentType: 'claude-code',
      assistantMessageId: 'msg-1',
      jwt: 'jwt',
      marketService: {} as any,
      operationId: 'op-1',
      prompt: 'hi',
      topicId: 'topic-1',
      userId: 'user-1',
      workspaceId: 'ws-lobehub',
    });

    const command = mockCallTool.mock.calls[0][1].command;
    expect(command).toContain("LOBEHUB_WORKSPACE_ID='ws-lobehub'");
  });
});

describe('spawnHeteroSandbox forwarded environment', () => {
  const run = () =>
    spawnHeteroSandbox({
      agentType: 'opencode',
      assistantMessageId: 'msg-1',
      jwt: 'jwt',
      marketService: {} as any,
      operationId: 'op-1',
      prompt: 'hi',
      topicId: 'topic-1',
      userId: 'user-1',
    });

  const lastCommand = () => mockCallTool.mock.calls.at(-1)?.[1].command as string;

  beforeEach(() => {
    mockCallTool.mockClear();
    mockCallTool.mockResolvedValue({ success: true });
    forwardEnv(undefined);
    delete process.env.OPENCODE_CONFIG_CONTENT;
    delete process.env.NOT_ALLOWLISTED;
  });

  it('forwards nothing when the deployment has not opted in', async () => {
    process.env.OPENCODE_CONFIG_CONTENT = '{"model":"x"}';

    await run();

    expect(lastCommand()).not.toContain('OPENCODE_CONFIG_CONTENT=');
  });

  it('forwards an allowlisted variable, shell-quoted', async () => {
    process.env.OPENCODE_CONFIG_CONTENT = '{"model":"it\'s fine"}';
    forwardEnv('OPENCODE_CONFIG_CONTENT');

    await run();

    // Single quotes inside the value must not close the quoting and leak the
    // rest of the config into the command line as shell words.
    expect(lastCommand()).toContain(`OPENCODE_CONFIG_CONTENT='{"model":"it'\\''s fine"}'`);
  });

  it('leaves out an allowlisted variable that is unset', async () => {
    forwardEnv('OPENCODE_CONFIG_CONTENT');

    await run();

    expect(lastCommand()).not.toContain('OPENCODE_CONFIG_CONTENT=');
  });

  it('never forwards a variable the allowlist does not name', async () => {
    process.env.NOT_ALLOWLISTED = 'secret';
    forwardEnv('OPENCODE_CONFIG_CONTENT');

    await run();

    expect(lastCommand()).not.toContain('NOT_ALLOWLISTED');
  });
});
