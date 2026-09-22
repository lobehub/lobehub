import { beforeEach, describe, expect, it, vi } from 'vitest';

import { spawnHeteroSandbox } from '../sandboxRunner';

const { mockCallTool } = vi.hoisted(() => ({
  mockCallTool: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock('@/envs/app', () => ({
  appEnv: { APP_URL: 'https://app.example.com' },
}));

const { mockCreateSandboxService } = vi.hoisted(() => ({
  mockCreateSandboxService: vi.fn(() => ({ callTool: mockCallTool })),
}));

vi.mock('@/server/services/sandbox', () => ({
  createSandboxService: mockCreateSandboxService,
}));

describe('spawnHeteroSandbox', () => {
  beforeEach(() => {
    mockCallTool.mockClear();
    mockCreateSandboxService.mockClear();
    mockCallTool.mockResolvedValue({ success: true });
  });

  it('pins an ephemeral run to /workspace and asks for no persistence', async () => {
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

    expect(mockCallTool.mock.calls[0][1].command).toContain("'--cwd' '/workspace'");
    expect(mockCreateSandboxService).toHaveBeenCalledWith({
      marketService: {},
      sandboxCwd: undefined,
      sandboxEnvironment: undefined,
      sandboxMode: undefined,
      topicId: 'topic-1',
      userId: 'user-1',
    });
  });

  it('runs a persistent topic in its instance and leaves the cwd to the execution plane', async () => {
    // Regression: a topic bound to an environment instance used to run in the
    // throwaway box at /workspace, because the runner never forwarded the
    // topic's persistence and hard-coded the directory.
    await spawnHeteroSandbox({
      agentType: 'claude-code',
      assistantMessageId: 'msg-1',
      jwt: 'jwt',
      marketService: {} as any,
      operationId: 'op-1',
      prompt: 'hi',
      sandbox: { cwd: 'lobehub-main', environment: 'inst-1', mode: 'persistent' },
      topicId: 'topic-1',
      userId: 'user-1',
    });

    expect(mockCallTool.mock.calls[0][1].command).not.toContain('--cwd');
    expect(mockCreateSandboxService).toHaveBeenCalledWith(
      expect.objectContaining({
        sandboxCwd: 'lobehub-main',
        sandboxEnvironment: 'inst-1',
        sandboxMode: 'persistent',
      }),
    );
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
