import { lobeHubCliGuideBlock } from '@lobechat/heterogeneous-agents/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { sandboxEnv } from '@/envs/sandbox';

import { resolveSandboxRunTTL, spawnHeteroSandbox } from '../sandboxRunner';

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

const { mockSandboxKind } = vi.hoisted(() => ({
  mockSandboxKind: { current: 'market' as 'market' | 'onlyboxes' },
}));

const { mockCreateSandboxService } = vi.hoisted(() => ({
  mockCreateSandboxService: vi.fn(() => ({
    callTool: mockCallTool,
    kind: mockSandboxKind.current,
  })),
}));

vi.mock('@/envs/sandbox', () => ({
  sandboxEnv: { HETERO_SANDBOX_RUN_TTL_SEC: undefined },
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
      sandboxInstanceId: undefined,
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
        sandboxInstanceId: 'inst-1',
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
    expect(payload).toEqual([lobeHubCliGuideBlock, { text: 'hi', type: 'text' }]);
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

describe('spawnHeteroSandbox on Onlyboxes', () => {
  const params = {
    agentType: 'codex' as const,
    assistantMessageId: 'msg-1',
    jwt: 'jwt',
    marketService: {} as any,
    operationId: 'op-1',
    prompt: 'hi',
    topicId: 'topic-1',
    userId: 'user-1',
  };

  beforeEach(() => {
    mockCallTool.mockClear();
    mockCallTool.mockResolvedValue({ success: true });
    mockSandboxKind.current = 'onlyboxes';
  });

  afterEach(() => {
    mockSandboxKind.current = 'market';
  });

  it('detaches the run so it outlives the ten-minute task', async () => {
    await spawnHeteroSandbox(params);

    const [, input] = mockCallTool.mock.calls[0];
    expect(input.background).toBeUndefined();
    expect(input.timeout).toBeLessThanOrEqual(600_000);
    expect(input.command).toMatch(/^setsid nohup sh -c '/);
    expect(input.command).toMatch(/> '\/tmp\/lobe-hetero-op-1\.log' 2>&1 < \/dev\/null &$/);
  });

  it('keeps the whole run, prompt included, inside the detached shell', async () => {
    await spawnHeteroSandbox(params);

    const command: string = mockCallTool.mock.calls[0][1].command;
    const inner = command.match(/^setsid nohup sh -c '(.*)' > /s)?.[1] ?? '';
    const unquoted = inner.replaceAll("'\\''", "'");
    expect(decodeStdinPayload(unquoted)).toContain('hi');
    expect(unquoted).toContain("'lh' 'hetero' 'exec' '--type' 'codex'");
  });

  it('keeps the background task on the Market sandbox', async () => {
    mockSandboxKind.current = 'market';
    await spawnHeteroSandbox(params);

    expect(mockCallTool.mock.calls[0][1]).toEqual(
      expect.objectContaining({ background: true, timeout: 600_000 }),
    );
  });
});

describe('resolveSandboxRunTTL', () => {
  const runTTL = (value: number | undefined) => {
    (sandboxEnv as { HETERO_SANDBOX_RUN_TTL_SEC?: number }).HETERO_SANDBOX_RUN_TTL_SEC = value;
  };

  afterEach(() => runTTL(undefined));

  it('defaults to four hours', () => {
    expect(resolveSandboxRunTTL()).toBe('14400s');
  });

  it('follows HETERO_SANDBOX_RUN_TTL_SEC', () => {
    runTTL(43_200);
    expect(resolveSandboxRunTTL()).toBe('43200s');
  });
});
