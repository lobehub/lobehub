import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { MarketService } from '@/server/services/market';

import {
  applyInjectedCredentialsToSandboxIfNeeded,
  buildApplyInjectedCredentialsCommand,
  hasSandboxInjectableCredentials,
} from '../applyInjectedCredentials';

const mocks = vi.hoisted(() => ({
  callTool: vi.fn(),
  createSandboxService: vi.fn(),
  getSandboxProviderKind: vi.fn(),
}));

vi.mock('../factory', () => ({
  createSandboxService: mocks.createSandboxService,
  getSandboxProviderKind: mocks.getSandboxProviderKind,
}));

const marketService = {} as MarketService;

describe('applyInjectedCredentials', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSandboxProviderKind.mockReturnValue('onlyboxes');
    mocks.createSandboxService.mockReturnValue({ callTool: mocks.callTool });
    mocks.callTool.mockResolvedValue({
      result: { exitCode: 0, success: true },
      success: true,
    });
  });

  describe('buildApplyInjectedCredentialsCommand', () => {
    it('returns null when there is nothing to apply', () => {
      expect(buildApplyInjectedCredentialsCommand({})).toBeNull();
      expect(buildApplyInjectedCredentialsCommand({ env: {}, files: [] })).toBeNull();
    });

    it('builds a python command for env credentials', () => {
      const command = buildApplyInjectedCredentialsCommand({
        env: { OPENAI_API_KEY: 'sk-test' },
      });

      expect(command).toContain('python3 -');
      expect(command).toContain('curl');
      expect(command).toContain('export');
      expect(command).toContain('shlex.quote');
      expect(command).toMatch(/main\('([A-Za-z0-9+/=]+)'\)/);

      const encoded = command!.match(/main\('([A-Za-z0-9+/=]+)'\)/)![1];
      const payload = JSON.parse(Buffer.from(encoded, 'base64').toString());

      expect(payload.env).toEqual({ OPENAI_API_KEY: 'sk-test' });
    });

    it('merges headers and file credentials', () => {
      const command = buildApplyInjectedCredentialsCommand({
        env: { API_KEY: 'abc' },
        files: [
          {
            content: 'https://files.example.com/cred.json',
            envName: 'GOOGLE_APPLICATION_CREDENTIALS',
            fileName: 'credentials.json',
            key: 'gcp-service-account',
          },
        ],
        headers: { X_API_KEY: 'header-value' },
      });

      const encoded = command!.match(/main\('([A-Za-z0-9+/=]+)'\)/)![1];
      const payload = JSON.parse(Buffer.from(encoded, 'base64').toString());

      expect(payload.env).toEqual({
        API_KEY: 'abc',
        X_API_KEY: 'header-value',
      });
      expect(payload.files).toEqual([
        {
          downloadUrl: 'https://files.example.com/cred.json',
          envName: 'GOOGLE_APPLICATION_CREDENTIALS',
          fileName: 'credentials.json',
          key: 'gcp-service-account',
        },
      ]);
    });
  });

  describe('hasSandboxInjectableCredentials', () => {
    it('detects env, header, and file credentials', () => {
      expect(hasSandboxInjectableCredentials({ env: { A: '1' } })).toBe(true);
      expect(hasSandboxInjectableCredentials({ headers: { A: '1' } })).toBe(true);
      expect(
        hasSandboxInjectableCredentials({
          files: [{ content: 'https://x', fileName: 'a.txt', key: 'k' }],
        }),
      ).toBe(true);
      expect(hasSandboxInjectableCredentials({})).toBe(false);
    });
  });

  describe('applyInjectedCredentialsToSandboxIfNeeded', () => {
    it('skips when provider is market', async () => {
      mocks.getSandboxProviderKind.mockReturnValue('market');

      const result = await applyInjectedCredentialsToSandboxIfNeeded({
        credentials: { env: { API_KEY: 'abc' } },
        marketService,
        topicId: 'topic-1',
        userId: 'user-1',
      });

      expect(result).toEqual({ applied: false });
      expect(mocks.createSandboxService).not.toHaveBeenCalled();
    });

    it('writes credentials through the sandbox service for onlyboxes', async () => {
      const result = await applyInjectedCredentialsToSandboxIfNeeded({
        credentials: { env: { API_KEY: 'abc' } },
        marketService,
        topicId: 'topic-1',
        userId: 'user-1',
      });

      expect(result).toEqual({ applied: true });
      expect(mocks.createSandboxService).toHaveBeenCalledWith({
        marketService,
        topicId: 'topic-1',
        userId: 'user-1',
      });
      expect(mocks.callTool).toHaveBeenCalledWith(
        'runCommand',
        expect.objectContaining({
          command: expect.stringContaining('python3 -'),
          timeout: 60_000,
        }),
      );
    });

    it('returns an error when sandbox write fails', async () => {
      mocks.callTool.mockResolvedValue({
        error: { message: 'sandbox failed' },
        success: false,
      });

      const result = await applyInjectedCredentialsToSandboxIfNeeded({
        credentials: { env: { API_KEY: 'abc' } },
        marketService,
        topicId: 'topic-1',
        userId: 'user-1',
      });

      expect(result).toEqual({
        applied: false,
        error: 'sandbox failed',
      });
    });
  });
});
