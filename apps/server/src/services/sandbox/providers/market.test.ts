import { describe, expect, it, vi } from 'vitest';

import type { MarketService } from '@/server/services/market';

import { MarketSandboxProvider, redactSandboxParams } from './market';

describe('MarketSandboxProvider', () => {
  const createMarketService = (response: unknown) =>
    ({
      exportFile: vi.fn(async () => response),
      getSDK: vi.fn(() => ({
        plugins: {
          runBuildInTool: vi.fn(async () => response),
        },
      })),
    }) as unknown as MarketService;

  it('keeps the previous Market sandbox callTool success response shape', async () => {
    const marketService = createMarketService({
      data: {
        result: {
          exitCode: 0,
          stdout: 'ok',
        },
        sessionExpiredAndRecreated: true,
      },
      success: true,
    });
    const provider = new MarketSandboxProvider({
      marketService,
      topicId: 'topic-1',
      userId: 'user-1',
    });

    const result = await provider.callTool('runCommand', { command: 'echo ok' });

    expect(result).toEqual({
      result: {
        exitCode: 0,
        stdout: 'ok',
      },
      sessionExpiredAndRecreated: true,
      success: true,
    });
  });

  it('keeps the previous Market sandbox callTool error mapping', async () => {
    const marketService = createMarketService({
      error: {
        code: 'token_expired',
        message: 'expired',
      },
      success: false,
    });
    const provider = new MarketSandboxProvider({
      marketService,
      topicId: 'topic-1',
      userId: 'user-1',
    });

    const result = await provider.callTool('runCommand', { command: 'echo ok' });

    expect(result).toEqual({
      error: {
        message: 'expired',
        name: 'token_expired',
      },
      result: null,
      sessionExpiredAndRecreated: false,
      success: false,
    });
  });

  it('forwards the agent step signal to the Market SDK request', async () => {
    const controller = new AbortController();
    const runBuildInTool = vi.fn(async () => ({ data: { result: {} }, success: true }));
    const marketService = {
      getSDK: vi.fn(() => ({ plugins: { runBuildInTool } })),
    } as unknown as MarketService;
    const provider = new MarketSandboxProvider({
      marketService,
      signal: controller.signal,
      topicId: 'topic-1',
      userId: 'user-1',
    });

    await provider.callTool('runCommand', { command: 'sleep 900', timeout: 120_000 });

    expect(runBuildInTool).toHaveBeenCalledWith(
      'runCommand',
      { command: 'sleep 900', timeout: 120_000 },
      { topicId: 'topic-1', userId: 'user-1' },
      { signal: controller.signal },
    );
  });

  it('preserves Market sandbox export error codes for authorization handling', async () => {
    const marketService = createMarketService({
      error: {
        code: 'token_expired',
        message: 'expired',
      },
      success: false,
    });
    const provider = new MarketSandboxProvider({
      marketService,
      topicId: 'topic-1',
      userId: 'user-1',
    });

    const result = await provider.exportFileToUploadUrl({
      filename: 'report.txt',
      path: '/workspace/report.txt',
      uploadUrl: 'https://uploads.example.com/put',
    });

    expect(result).toEqual({
      error: {
        message: 'expired',
        name: 'token_expired',
      },
      success: false,
    });
  });

  it('keeps the previous Market sandbox export success response shape', async () => {
    const marketService = createMarketService({
      data: {
        result: {
          mimeType: 'text/plain',
          success: true,
        },
      },
      success: true,
    });
    const provider = new MarketSandboxProvider({
      marketService,
      topicId: 'topic-1',
      userId: 'user-1',
    });

    const result = await provider.exportFileToUploadUrl({
      filename: 'report.txt',
      path: '/workspace/report.txt',
      uploadUrl: 'https://uploads.example.com/put',
    });

    expect(result).toEqual({
      mimeType: 'text/plain',
      result: {
        mimeType: 'text/plain',
        success: true,
      },
      success: true,
    });
  });

  it('keeps the previous Market sandbox upload failure mapping', async () => {
    const marketService = createMarketService({
      data: {
        result: {
          error: 'upload failed',
          success: false,
        },
      },
      success: true,
    });
    const provider = new MarketSandboxProvider({
      marketService,
      topicId: 'topic-1',
      userId: 'user-1',
    });

    const result = await provider.exportFileToUploadUrl({
      filename: 'report.txt',
      path: '/workspace/report.txt',
      uploadUrl: 'https://uploads.example.com/put',
    });

    expect(result).toEqual({
      error: {
        message: 'upload failed',
      },
      success: false,
    });
  });

  describe('redactSandboxParams', () => {
    it('redacts auth env assignments from command logs without changing other params', () => {
      const params = {
        command:
          'LOBEHUB_JWT=mock-jwt LOBEHUB_SERVER=https://app.lobehub.com npx -y @lobehub/cli topic list && GITHUB_TOKEN="ghp_token" gh repo view',
        timeout: 1000,
      };

      expect(redactSandboxParams(params)).toEqual({
        command:
          'LOBEHUB_JWT=[redacted] LOBEHUB_SERVER=https://app.lobehub.com npx -y @lobehub/cli topic list && GITHUB_TOKEN=[redacted] gh repo view',
        timeout: 1000,
      });
    });

    it('redacts sandbox resource URLs from params', () => {
      expect(
        redactSandboxParams({
          skillZipUrls: { chart: 'https://files.example.com/chart.zip' },
          zipUrl: 'https://files.example.com/legacy.zip',
        }),
      ).toEqual({
        skillZipUrls: '[redacted]',
        zipUrl: '[redacted]',
      });
    });
  });
});
