import { lobeHubCliGuide } from '@lobechat/heterogeneous-agents/protocol';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
