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

  // The instance the call belongs to and where it runs travel together: the
  // execution plane scopes a shared workspace by the first and runs commands
  // in the second.
  it('forwards the instance directory and the local working directory together', async () => {
    const runBuildInTool = vi.fn(async () => ({ data: { result: {} }, success: true }));
    const marketService = {
      getSDK: vi.fn(() => ({ plugins: { runBuildInTool } })),
    } as unknown as MarketService;
    const provider = new MarketSandboxProvider({
      marketService,
      sandboxCwd: 'projects/atlas',
      sandboxMode: 'persistent',
      sandboxWorkingDir: '/root/work',
      topicId: 'topic-1',
      userId: 'user-1',
    });

    await provider.callTool('runCommand', { command: 'pwd' });

    expect(runBuildInTool).toHaveBeenCalledWith(
      'runCommand',
      { command: 'pwd' },
      expect.objectContaining({ sandboxCwd: 'projects/atlas', sandboxWorkingDir: '/root/work' }),
    );
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

    it('fully redacts a command that writes into ~/.creds/env, regardless of the credential names it carries', () => {
      const params = {
        command:
          "mkdir -p ~/.creds && \\\n(printf '%s\\n' 'export DC_CLI_TOKEN='\\''sk-super-secret'\\''') >> ~/.creds/env",
      };

      expect(redactSandboxParams(params)).toEqual({
        command: '[redacted]',
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

/**
 * The provider tests above mock `runBuildInTool`, so they prove only that the
 * provider hands the persistence fields over — they pass against an SDK that
 * then drops every one of them on the floor, which is exactly what shipped and
 * sent weeks of persistent runs into a throwaway sandbox.
 *
 * This one drives the REAL SDK with only its transport replaced, so it asserts
 * the thing that actually broke: that the fields survive serialization and
 * reach Market in the request body.
 */
describe('MarketSandboxProvider · persistence fields on the wire', () => {
  const callWithRealSDK = async () => {
    const { MarketSDK } = await import('@lobehub/market-sdk');
    const fetchMock = vi.fn(async () => ({
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ data: { result: { exitCode: 0, stdout: '' } }, success: true }),
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ data: {}, success: true }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const sdk = new MarketSDK({ baseURL: 'https://market.test' });
    const provider = new MarketSandboxProvider({
      marketService: { getSDK: () => sdk } as unknown as MarketService,
      sandboxCwd: 'inst-a',
      sandboxInstanceId: 'env-abc',
      sandboxMode: 'persistent',
      topicId: 'tpc_1',
      userId: 'user_1',
    } as never);

    await provider.callTool('runCommand', { command: 'pwd' }).catch(() => undefined);
    vi.unstubAllGlobals();

    const call = fetchMock.mock.calls.find(([url]) =>
      String(url).includes('/v1/plugins/run-buildin-tools'),
    );
    return call ? JSON.parse(String((call[1] as RequestInit).body)) : undefined;
  };

  it('sends sandboxMode, sandboxInstanceId and sandboxCwd in the request body', async () => {
    const body = await callWithRealSDK();

    // Without these the execution plane reads the call as ephemeral, mounts no
    // volume, and reports success anyway.
    expect(body).toMatchObject({
      sandboxCwd: 'inst-a',
      sandboxInstanceId: 'env-abc',
      sandboxMode: 'persistent',
    });
  });
});
