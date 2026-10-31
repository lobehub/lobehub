import type * as fsModule from 'node:fs';
import { existsSync, statSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type * as spawnModule from '@lobechat/heterogeneous-agents/spawn';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { App } from '@/core/App';

import HeterogeneousAgentCtr from '../HeterogeneousAgentImpl';

const { droidAcpSessionConstructMock, settleServerDefaultOperationMock } = vi.hoisted(() => ({
  droidAcpSessionConstructMock: vi.fn(),
  settleServerDefaultOperationMock: vi.fn(),
}));

vi.mock('@lobechat/heterogeneous-agents/spawn', async (importOriginal) => {
  const actual = await importOriginal<typeof spawnModule>();
  class MockDroidAcpSession {
    constructor(options: unknown) {
      droidAcpSessionConstructMock(options);
    }

    close() {}

    async run() {}
  }
  return { ...actual, DroidAcpSession: MockDroidAcpSession };
});

vi.mock('@/modules/heterogeneousAgent/providerBindingPort', () => ({
  beginServerDefaultOperation: vi.fn(async () => ({
    endpoint: 'https://app.example.com',
    model: 'vendor/model',
    token: 'operation-token',
  })),
  describeServerDefaultModel: vi.fn(async () => undefined),
  getServerDefaultEndpoint: vi.fn(async () => 'https://app.example.com'),
  settleServerDefaultOperation: settleServerDefaultOperationMock,
}));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof fsModule>();
  return { ...actual, existsSync: vi.fn(() => true), statSync: vi.fn() };
});

vi.mock('@/modules/binaries', () => ({
  detectHeterogeneousCliCommand: vi.fn(async () => ({
    available: true,
    path: '/usr/local/bin/droid',
    resolvedPathEnv: '/usr/local/bin:/usr/bin',
  })),
}));

describe('HeterogeneousAgentCtr Droid server-default', () => {
  let appStoragePath: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    settleServerDefaultOperationMock.mockResolvedValue({ success: true });
    vi.mocked(existsSync).mockReturnValue(true);
    // The fake desktop path is a directory for spawn preflight; binding files stay real.
    vi.mocked(statSync).mockReturnValue({ isDirectory: () => true } as ReturnType<typeof statSync>);
    appStoragePath = await mkdtemp(path.join(os.tmpdir(), 'lobehub-droid-server-default-'));
  });

  afterEach(async () => {
    await rm(appStoragePath, { force: true, recursive: true });
  });

  /** @example User args stay validated while the host settings file reaches the CLI. */
  it('passes the managed settings file outside the user arguments', async () => {
    const ctr = new HeterogeneousAgentCtr({
      appStoragePath,
      storeManager: { get: vi.fn() },
    } as unknown as App);
    const { sessionId } = await ctr.startSession({
      agentType: 'droid',
      args: ['--tag', 'lobe'],
      command: 'droid',
      providerBinding: {
        apiConfig: { model: 'vendor/model', source: 'server-default' },
        kind: 'server-default',
      },
    });

    await ctr.sendPrompt({ operationId: 'op-droid', prompt: 'hello', sessionId, topicId: 't-1' });

    const options = droidAcpSessionConstructMock.mock.calls[0][0];
    expect(options).toMatchObject({
      args: ['--tag', 'lobe'],
      initialModel: 'custom:LobeHub-Server-Default-0',
      settingsPath: expect.stringContaining(appStoragePath),
    });
    expect(options.env.LOBEHUB_DROID_API_KEY).toBe('operation-token');
    expect(JSON.parse(await readFile(options.settingsPath, 'utf8'))).toMatchObject({
      customModels: [{ apiKey: '${LOBEHUB_DROID_API_KEY}', model: 'lobehub/vendor/model' }],
    });
  });
});
