import { DataSyncConfig } from '@lobechat/electron-client-ipc';
import { BrowserWindow, shell } from 'electron';
import crypto from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { App } from '@/core/App';

import AuthCtr from '../AuthCtr';
import RemoteServerConfigCtr from '../RemoteServerConfigCtr';

// Mock logger
vi.mock('@/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

const { ipcMainHandleMock } = vi.hoisted(() => ({
  ipcMainHandleMock: vi.fn(),
}));

// Mock electron
vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: vi.fn(() => []),
  },
  ipcMain: {
    handle: ipcMainHandleMock,
  },
  shell: {
    openExternal: vi.fn().mockResolvedValue(undefined),
  },
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: vi.fn((str: string) => Buffer.from(str)),
    decryptString: vi.fn((buffer: Buffer) => buffer.toString()),
  },
}));

// Mock electron-is
vi.mock('electron-is', () => ({
  macOS: vi.fn(() => false),
  windows: vi.fn(() => false),
  linux: vi.fn(() => false),
}));

// Mock OFFICIAL_CLOUD_SERVER
vi.mock('@/const/env', () => ({
  OFFICIAL_CLOUD_SERVER: 'https://lobehub-cloud.com',
  isMac: false,
  isWindows: false,
  isLinux: false,
  isDev: false,
}));

// Mock crypto
let randomBytesCounter = 0;
vi.mock('node:crypto', () => ({
  default: {
    randomBytes: vi.fn((size: number) => {
      randomBytesCounter++;
      return {
        toString: vi.fn(() => `mock-random-${randomBytesCounter}`),
      };
    }),
    subtle: {
      digest: vi.fn(() => Promise.resolve(new ArrayBuffer(32))),
    },
  },
}));

// Create mock App and RemoteServerConfigCtr
const mockRemoteServerConfigCtr = {
  clearTokens: vi.fn().mockResolvedValue(undefined),
  getAccessToken: vi.fn().mockResolvedValue('mock-access-token'),
  getLastTokenRefreshAt: vi.fn().mockReturnValue(Date.now()),
  getRemoteServerConfig: vi.fn().mockResolvedValue({ active: true, storageMode: 'cloud' }),
  getRemoteServerUrl: vi.fn().mockImplementation(async (config?: DataSyncConfig) => {
    if (config?.storageMode === 'selfHost') {
      return config.remoteServerUrl || 'https://mock-server.com';
    }
    return 'https://lobehub-cloud.com'; // OFFICIAL_CLOUD_SERVER
  }),
  getTokenExpiresAt: vi.fn().mockReturnValue(Date.now() + 3600000),
  isNonRetryableError: vi.fn().mockReturnValue(false),
  isRemoteServerConfigured: vi.fn().mockResolvedValue(true),
  isTokenExpiringSoon: vi.fn().mockReturnValue(false),
  refreshAccessToken: vi.fn().mockResolvedValue({ success: true }),
  saveTokens: vi.fn().mockResolvedValue(undefined),
  setRemoteServerConfig: vi.fn().mockResolvedValue(true),
} as unknown as RemoteServerConfigCtr;

const mockApp = {
  getController: vi.fn((ControllerClass) => {
    if (ControllerClass === RemoteServerConfigCtr) {
      return mockRemoteServerConfigCtr;
    }
    return null;
  }),
} as unknown as App;

describe('AuthCtr', () => {
  let authCtr: AuthCtr;
  let mockFetch: ReturnType<typeof vi.fn>;
  let mockWindow: any;

  beforeEach(() => {
    vi.clearAllMocks();
    ipcMainHandleMock.mockClear();
    randomBytesCounter = 0; // Reset counter for each test

    // Reset shell.openExternal to default successful behavior
    vi.mocked(shell.openExternal).mockResolvedValue(undefined);

    // Create fresh instance for each test
    authCtr = new AuthCtr(mockApp);

    // Mock global fetch
    mockFetch = vi.fn();
    global.fetch = mockFetch;

    // Mock BrowserWindow with send spy
    mockWindow = {
      isDestroyed: vi.fn(() => false),
      webContents: {
        send: vi.fn(),
      },
    };
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([mockWindow]);
  });

  afterEach(() => {
    // Clean up authCtr intervals (using real timers, not fake timers)
    authCtr?.cleanup?.();
    // Clean up any fake timers if used
    vi.clearAllTimers();
  });

  describe('Basic functionality', () => {
    // Use real timers for all tests since setInterval with async doesn't work well with fake timers

    describe('requestAuthorization', () => {
      it('should generate PKCE parameters and open authorization URL', async () => {
        const config: DataSyncConfig = {
          active: false,
          storageMode: 'cloud',
        };

        mockFetch.mockResolvedValue({
          status: 404,
          ok: false,
        });

        const result = await authCtr.requestAuthorization(config);

        // Verify success response
        expect(result).toEqual({ success: true });

        // Verify shell.openExternal was called with correct URL
        expect(shell.openExternal).toHaveBeenCalledWith(
          expect.stringContaining('https://lobehub-cloud.com/oidc/auth'),
        );

        // Verify URL contains required parameters
        const authUrl = vi.mocked(shell.openExternal).mock.calls[0][0];
        expect(authUrl).toContain('client_id=lobehub-desktop');
        expect(authUrl).toContain('response_type=code');
        expect(authUrl).toContain('code_challenge_method=S256');
        expect(authUrl).toContain('scope=profile%20email%20offline_access');
      });

      it('should start polling after authorization request', async () => {
        const config: DataSyncConfig = {
          active: false,
          storageMode: 'cloud',
        };

        mockFetch.mockResolvedValue({
          status: 404,
          ok: false,
        });

        const result = await authCtr.requestAuthorization(config);
        expect(result.success).toBe(true);

        // Wait a bit for polling to start
        await new Promise((resolve) => setTimeout(resolve, 3500));

        // Verify fetch was called for polling
        const pollingCalls = mockFetch.mock.calls.filter((call) =>
          (call[0] as string).includes('/oidc/handoff'),
        );
        expect(pollingCalls.length).toBeGreaterThan(0);
      });

      it('should use self-hosted server URL when storageMode is selfHost', async () => {
        const config: DataSyncConfig = {
          active: false,
          storageMode: 'selfHost',
          remoteServerUrl: 'https://my-custom-server.com',
        };

        mockFetch.mockResolvedValue({
          status: 404,
          ok: false,
        });

        await authCtr.requestAuthorization(config);

        // Verify shell.openExternal was called with custom URL
        expect(shell.openExternal).toHaveBeenCalledWith(
          expect.stringContaining('https://my-custom-server.com/oidc/auth'),
        );
      });

      it('should handle authorization request error gracefully', async () => {
        const config: DataSyncConfig = {
          active: false,
          storageMode: 'cloud',
        };

        vi.mocked(shell.openExternal).mockRejectedValue(new Error('Failed to open browser'));

        const result = await authCtr.requestAuthorization(config);

        expect(result.success).toBe(false);
        expect(result.error).toContain('Failed to open browser');
      });
    });

    describe('polling mechanism', () => {
      it('should poll every 3 seconds', async () => {
        const config: DataSyncConfig = {
          active: false,
          storageMode: 'cloud',
        };

        mockFetch.mockResolvedValue({
          status: 404,
          ok: false,
        });

        await authCtr.requestAuthorization(config);

        // Wait for first poll
        await new Promise((resolve) => setTimeout(resolve, 3100));

        const firstCallCount = mockFetch.mock.calls.filter((call) =>
          (call[0] as string).includes('/oidc/handoff'),
        ).length;
        expect(firstCallCount).toBeGreaterThanOrEqual(1);

        // Wait for second poll
        await new Promise((resolve) => setTimeout(resolve, 3000));

        const secondCallCount = mockFetch.mock.calls.filter((call) =>
          (call[0] as string).includes('/oidc/handoff'),
        ).length;
        expect(secondCallCount).toBeGreaterThanOrEqual(2);
      }, 10000);

      it('should stop polling when credentials are received', async () => {
        const config: DataSyncConfig = {
          active: false,
          storageMode: 'cloud',
        };

        let pollCount = 0;
        mockFetch.mockImplementation((url: string) => {
          const urlObj = new URL(url);

          // Return success on third poll
          if (urlObj.pathname.includes('/oidc/handoff')) {
            pollCount++;
            if (pollCount >= 3) {
              return Promise.resolve({
                status: 200,
                ok: true,
                json: () =>
                  Promise.resolve({
                    success: true,
                    data: {
                      payload: {
                        code: 'mock-auth-code',
                        state: 'mock-random-2', // Second randomBytes call is for state
                      },
                    },
                  }),
                text: () => Promise.resolve('mock response'),
              });
            }
          }

          // Token exchange endpoint
          if (urlObj.pathname.includes('/oidc/token')) {
            return Promise.resolve({
              status: 200,
              ok: true,
              json: () =>
                Promise.resolve({
                  access_token: 'new-access-token',
                  refresh_token: 'new-refresh-token',
                  expires_in: 3600,
                }),
              text: () => Promise.resolve('mock response'),
              clone: () => ({
                json: () =>
                  Promise.resolve({
                    access_token: 'new-access-token',
                    refresh_token: 'new-refresh-token',
                    expires_in: 3600,
                  }),
              }),
            });
          }

          return Promise.resolve({
            status: 404,
            ok: false,
          });
        });

        await authCtr.requestAuthorization(config);

        // Wait for polling to complete
        await new Promise((resolve) => setTimeout(resolve, 10000));

        const pollCountBefore = pollCount;

        // Wait more time and verify no more polling
        await new Promise((resolve) => setTimeout(resolve, 3500));
        expect(pollCount).toBe(pollCountBefore);
      }, 15000);

      it('should broadcast authorizationSuccessful when credentials are exchanged', async () => {
        const config: DataSyncConfig = {
          active: false,
          storageMode: 'cloud',
        };

        mockFetch.mockImplementation((url: string) => {
          const urlObj = new URL(url);

          if (urlObj.pathname.includes('/oidc/handoff')) {
            return Promise.resolve({
              status: 200,
              ok: true,
              json: () =>
                Promise.resolve({
                  success: true,
                  data: {
                    payload: {
                      code: 'mock-auth-code',
                      state: 'mock-random-2', // Second randomBytes call is for state
                    },
                  },
                }),
              text: () => Promise.resolve('mock response'),
            });
          }

          if (urlObj.pathname.includes('/oidc/token')) {
            return Promise.resolve({
              status: 200,
              ok: true,
              json: () =>
                Promise.resolve({
                  access_token: 'new-access-token',
                  refresh_token: 'new-refresh-token',
                  expires_in: 3600,
                }),
              text: () => Promise.resolve('mock response'),
              clone: () => ({
                json: () =>
                  Promise.resolve({
                    access_token: 'new-access-token',
                    refresh_token: 'new-refresh-token',
                    expires_in: 3600,
                  }),
              }),
            });
          }

          return Promise.resolve({ status: 404, ok: false });
        });

        await authCtr.requestAuthorization(config);

        // Wait for polling to complete and token exchange
        await new Promise((resolve) => setTimeout(resolve, 4000));

        // Verify authorizationSuccessful was broadcast
        expect(mockWindow.webContents.send).toHaveBeenCalledWith('authorizationSuccessful');
      }, 6000);

      it('should validate state parameter and reject mismatched state', async () => {
        const config: DataSyncConfig = {
          active: false,
          storageMode: 'cloud',
        };

        mockFetch.mockImplementation((url: string) => {
          const urlObj = new URL(url);

          if (urlObj.pathname.includes('/oidc/handoff')) {
            return Promise.resolve({
              status: 200,
              ok: true,
              json: () =>
                Promise.resolve({
                  success: true,
                  data: {
                    payload: {
                      code: 'mock-auth-code',
                      state: 'wrong-state', // Mismatched state
                    },
                  },
                }),
            });
          }

          return Promise.resolve({ status: 404, ok: false });
        });

        await authCtr.requestAuthorization(config);

        // Wait for polling and state validation
        await new Promise((resolve) => setTimeout(resolve, 4000));

        // Verify authorizationFailed was broadcast with state error
        expect(mockWindow.webContents.send).toHaveBeenCalledWith('authorizationFailed', {
          error: 'Invalid state parameter',
        });
      }, 6000);
    });

    describe('token refresh', () => {
      it('should start auto-refresh after successful authorization', async () => {
        const config: DataSyncConfig = {
          active: false,
          storageMode: 'cloud',
        };

        mockFetch.mockImplementation((url: string) => {
          const urlObj = new URL(url);

          if (urlObj.pathname.includes('/oidc/handoff')) {
            return Promise.resolve({
              status: 200,
              ok: true,
              json: () =>
                Promise.resolve({
                  success: true,
                  data: {
                    payload: {
                      code: 'mock-auth-code',
                      state: 'mock-random-2', // Second randomBytes call is for state
                    },
                  },
                }),
              text: () => Promise.resolve('mock response'),
            });
          }

          if (urlObj.pathname.includes('/oidc/token')) {
            return Promise.resolve({
              status: 200,
              ok: true,
              json: () =>
                Promise.resolve({
                  access_token: 'new-access-token',
                  refresh_token: 'new-refresh-token',
                  expires_in: 3600,
                }),
              text: () => Promise.resolve('mock response'),
              clone: () => ({
                json: () =>
                  Promise.resolve({
                    access_token: 'new-access-token',
                    refresh_token: 'new-refresh-token',
                    expires_in: 3600,
                  }),
              }),
            });
          }

          return Promise.resolve({ status: 404, ok: false });
        });

        await authCtr.requestAuthorization(config);

        // Wait for polling and token exchange
        await new Promise((resolve) => setTimeout(resolve, 4000));

        // Verify saveTokens was called
        expect(mockRemoteServerConfigCtr.saveTokens).toHaveBeenCalledWith(
          'new-access-token',
          'new-refresh-token',
          3600,
        );

        // Verify remote server was set to active
        expect(mockRemoteServerConfigCtr.setRemoteServerConfig).toHaveBeenCalledWith({
          active: true,
        });
      }, 6000);
    });
  });

  describe('Scenario: Authorization Timeout and Retry', () => {
    // All scenario tests use real timers

    it('Step 1: User requests authorization but does not complete it within 5 minutes', async () => {
      const config: DataSyncConfig = {
        active: false,
        storageMode: 'cloud',
      };

      // Mock: User never completes authorization, so polling always returns 404
      mockFetch.mockResolvedValue({
        status: 404,
        ok: false,
      });

      // User clicks "Connect to Cloud" button
      await authCtr.requestAuthorization(config);

      // Wait for some polling to happen
      await new Promise((resolve) => setTimeout(resolve, 10000));

      const handoffCallsBeforeTimeout = mockFetch.mock.calls.filter((call) =>
        (call[0] as string).includes('/oidc/handoff'),
      ).length;
      expect(handoffCallsBeforeTimeout).toBeGreaterThan(0);

      // Verify polling is active by checking calls increased
      const callsBefore = handoffCallsBeforeTimeout;
      await new Promise((resolve) => setTimeout(resolve, 3500));
      const callsAfter = mockFetch.mock.calls.filter((call) =>
        (call[0] as string).includes('/oidc/handoff'),
      ).length;
      expect(callsAfter).toBeGreaterThan(callsBefore);
    }, 15000); // Increase test timeout

    it('Step 2: User clicks retry button after previous attempt', async () => {
      const config: DataSyncConfig = {
        active: false,
        storageMode: 'cloud',
      };

      mockFetch.mockResolvedValue({
        status: 404,
        ok: false,
      });

      // First attempt
      await authCtr.requestAuthorization(config);
      await new Promise((resolve) => setTimeout(resolve, 3500));

      // Reset mock to track retry
      mockFetch.mockClear();

      // User clicks retry button - should start fresh authorization
      await authCtr.requestAuthorization(config);

      // Verify: New polling started
      await new Promise((resolve) => setTimeout(resolve, 3500));

      const handoffCalls = mockFetch.mock.calls.filter((call) =>
        (call[0] as string).includes('/oidc/handoff'),
      );
      expect(handoffCalls.length).toBeGreaterThan(0);
    }, 10000);

    it('Step 3: Retry generates new state parameter (not reusing old state)', async () => {
      const config: DataSyncConfig = {
        active: false,
        storageMode: 'cloud',
      };

      const capturedStates: string[] = [];

      mockFetch.mockImplementation((url: string) => {
        const urlObj = new URL(url);
        const stateParam = urlObj.searchParams.get('id');
        if (stateParam && !capturedStates.includes(stateParam)) {
          capturedStates.push(stateParam);
        }
        return Promise.resolve({ status: 404, ok: false });
      });

      // First authorization attempt
      await authCtr.requestAuthorization(config);
      await new Promise((resolve) => setTimeout(resolve, 3500));
      const firstState = capturedStates[0];

      // Clear for second attempt tracking
      const firstAttemptStates = [...capturedStates];
      capturedStates.length = 0;

      // Retry - should generate NEW state
      await authCtr.requestAuthorization(config);
      await new Promise((resolve) => setTimeout(resolve, 3500));
      const secondState = capturedStates[0];

      // CRITICAL: States must be different
      expect(firstState).toBeDefined();
      expect(secondState).toBeDefined();
      expect(secondState).not.toBe(firstState);
      expect(firstAttemptStates).not.toContain(secondState);
    }, 10000);

    it('Step 4: User completes authorization on retry successfully', async () => {
      const config: DataSyncConfig = {
        active: false,
        storageMode: 'cloud',
      };

      // First attempt - incomplete
      mockFetch.mockResolvedValue({ status: 404, ok: false });
      await authCtr.requestAuthorization(config);
      await new Promise((resolve) => setTimeout(resolve, 3500));

      // Second attempt - user completes it this time
      mockFetch.mockImplementation((url: string) => {
        const urlObj = new URL(url);

        // Handoff returns credentials immediately
        if (urlObj.pathname.includes('/oidc/handoff')) {
          return Promise.resolve({
            status: 200,
            ok: true,
            json: () =>
              Promise.resolve({
                success: true,
                data: {
                  payload: {
                    code: 'authorization-code',
                    state: 'mock-random-4', // Matches second request's state (3rd and 4th randomBytes calls)
                  },
                },
              }),
            text: () => Promise.resolve('mock response'),
          });
        }

        // Token exchange succeeds
        if (urlObj.pathname.includes('/oidc/token')) {
          return Promise.resolve({
            status: 200,
            ok: true,
            json: () =>
              Promise.resolve({
                access_token: 'access-token',
                refresh_token: 'refresh-token',
                expires_in: 3600,
              }),
            text: () => Promise.resolve('mock response'),
            clone: () => ({
              json: () =>
                Promise.resolve({
                  access_token: 'access-token',
                  refresh_token: 'refresh-token',
                  expires_in: 3600,
                }),
            }),
          });
        }

        return Promise.resolve({ status: 404, ok: false });
      });

      await authCtr.requestAuthorization(config);

      // Wait longer for polling and token exchange
      await new Promise((resolve) => setTimeout(resolve, 4000));

      // Verify: Success message shown
      const successCall = mockWindow.webContents.send.mock.calls.find(
        (call: any[]) => call[0] === 'authorizationSuccessful',
      );
      expect(successCall).toBeDefined();

      // Verify: Tokens saved
      expect(mockRemoteServerConfigCtr.saveTokens).toHaveBeenCalled();
    }, 12000);

    it('Edge case: Rapid retry clicks should not create multiple polling intervals', async () => {
      const config: DataSyncConfig = {
        active: false,
        storageMode: 'cloud',
      };

      mockFetch.mockResolvedValue({ status: 404, ok: false });

      // User rapidly clicks retry multiple times
      await authCtr.requestAuthorization(config);
      await authCtr.requestAuthorization(config);
      await authCtr.requestAuthorization(config);

      // Wait for some polling to happen
      await new Promise((resolve) => setTimeout(resolve, 9000));

      // Count handoff requests
      const handoffCalls = mockFetch.mock.calls.filter((call) =>
        (call[0] as string).includes('/oidc/handoff'),
      );

      // Should have ~3 calls (one per 3-second interval), not ~9 (3 intervals running)
      // Allow some tolerance for timing
      expect(handoffCalls.length).toBeLessThanOrEqual(5);
    }, 10000);
  });

  describe('Proactive Token Refresh', () => {
    const FIVE_MINUTES = 5 * 60 * 1000; // Debounce interval

    beforeEach(() => {
      // Reset mocks for proactive refresh tests
      vi.mocked(mockRemoteServerConfigCtr.getRemoteServerConfig).mockResolvedValue({
        active: true,
        remoteServerUrl: 'https://lobehub-cloud.com',
        storageMode: 'cloud',
      });
      vi.mocked(mockRemoteServerConfigCtr.isRemoteServerConfigured).mockResolvedValue(true);
      vi.mocked(mockRemoteServerConfigCtr.getAccessToken).mockResolvedValue('mock-access-token');
      vi.mocked(mockRemoteServerConfigCtr.getTokenExpiresAt).mockReturnValue(
        Date.now() + 3600000, // Token valid for 1 hour
      );
      // Reset getLastTokenRefreshAt to a recent value by default
      // Individual tests will override this as needed
      vi.mocked(mockRemoteServerConfigCtr.getLastTokenRefreshAt).mockReturnValue(Date.now());
    });

    describe('onAppActivate', () => {
      it('should refresh token when last refresh was more than 5 minutes ago', async () => {
        // Last refresh was 10 minutes ago (exceeds 5-minute debounce)
        vi.mocked(mockRemoteServerConfigCtr.getLastTokenRefreshAt).mockReturnValue(
          Date.now() - 10 * 60 * 1000,
        );
        vi.mocked(mockRemoteServerConfigCtr.refreshAccessToken).mockResolvedValue({
          success: true,
        });

        await authCtr.onAppActivate();

        expect(mockRemoteServerConfigCtr.refreshAccessToken).toHaveBeenCalled();
        expect(mockWindow.webContents.send).toHaveBeenCalledWith('tokenRefreshed');
      });

      it('should NOT refresh token when last refresh was within 5 minutes', async () => {
        // Last refresh was 2 minutes ago (within 5-minute debounce)
        vi.mocked(mockRemoteServerConfigCtr.getLastTokenRefreshAt).mockReturnValue(
          Date.now() - 2 * 60 * 1000,
        );

        await authCtr.onAppActivate();

        expect(mockRemoteServerConfigCtr.refreshAccessToken).not.toHaveBeenCalled();
      });

      it('should refresh token when lastRefreshAt is undefined (never refreshed)', async () => {
        vi.mocked(mockRemoteServerConfigCtr.getLastTokenRefreshAt).mockReturnValue(undefined);
        vi.mocked(mockRemoteServerConfigCtr.refreshAccessToken).mockResolvedValue({
          success: true,
        });

        await authCtr.onAppActivate();

        expect(mockRemoteServerConfigCtr.refreshAccessToken).toHaveBeenCalled();
      });

      it('should skip refresh when remote server is not active', async () => {
        vi.mocked(mockRemoteServerConfigCtr.isRemoteServerConfigured).mockResolvedValue(false);
        vi.mocked(mockRemoteServerConfigCtr.getLastTokenRefreshAt).mockReturnValue(
          Date.now() - 10 * 60 * 1000,
        );

        await authCtr.onAppActivate();

        expect(mockRemoteServerConfigCtr.refreshAccessToken).not.toHaveBeenCalled();
      });

      it('should skip refresh when no access token exists', async () => {
        vi.mocked(mockRemoteServerConfigCtr.getAccessToken).mockResolvedValue(null);
        vi.mocked(mockRemoteServerConfigCtr.getLastTokenRefreshAt).mockReturnValue(
          Date.now() - 10 * 60 * 1000,
        );

        await authCtr.onAppActivate();

        expect(mockRemoteServerConfigCtr.refreshAccessToken).not.toHaveBeenCalled();
      });

      it('should handle refresh failure with non-retryable error', async () => {
        vi.mocked(mockRemoteServerConfigCtr.getLastTokenRefreshAt).mockReturnValue(
          Date.now() - 10 * 60 * 1000,
        );
        vi.mocked(mockRemoteServerConfigCtr.refreshAccessToken).mockResolvedValue({
          error: 'invalid_grant',
          success: false,
        });
        vi.mocked(mockRemoteServerConfigCtr.isNonRetryableError).mockReturnValue(true);

        await authCtr.onAppActivate();

        expect(mockRemoteServerConfigCtr.clearTokens).toHaveBeenCalled();
        expect(mockRemoteServerConfigCtr.setRemoteServerConfig).toHaveBeenCalledWith({
          active: false,
        });
        expect(mockWindow.webContents.send).toHaveBeenCalledWith('authorizationRequired');
      });

      it('should handle refresh failure with transient error (start auto-refresh)', async () => {
        vi.mocked(mockRemoteServerConfigCtr.getLastTokenRefreshAt).mockReturnValue(
          Date.now() - 10 * 60 * 1000,
        );
        vi.mocked(mockRemoteServerConfigCtr.refreshAccessToken).mockResolvedValue({
          error: 'network_error',
          success: false,
        });
        vi.mocked(mockRemoteServerConfigCtr.isNonRetryableError).mockReturnValue(false);

        await authCtr.onAppActivate();

        // Should not clear tokens for transient errors
        expect(mockRemoteServerConfigCtr.clearTokens).not.toHaveBeenCalled();
      });
    });

    describe('afterAppReady (initializeAutoRefresh)', () => {
      it('should proactively refresh token on startup when debounce interval exceeded', async () => {
        // Last refresh was 10 minutes ago (exceeds 5-minute debounce)
        vi.mocked(mockRemoteServerConfigCtr.getLastTokenRefreshAt).mockReturnValue(
          Date.now() - 10 * 60 * 1000,
        );
        vi.mocked(mockRemoteServerConfigCtr.refreshAccessToken).mockResolvedValue({
          success: true,
        });

        authCtr.afterAppReady();

        // Wait for async initialization
        await new Promise((resolve) => setTimeout(resolve, 100));

        expect(mockRemoteServerConfigCtr.refreshAccessToken).toHaveBeenCalled();
      });

      it('should NOT refresh on startup when token was recently refreshed (within debounce)', async () => {
        // Last refresh was 2 minutes ago (within 5-minute debounce)
        vi.mocked(mockRemoteServerConfigCtr.getLastTokenRefreshAt).mockReturnValue(
          Date.now() - 2 * 60 * 1000,
        );

        authCtr.afterAppReady();

        // Wait for async initialization
        await new Promise((resolve) => setTimeout(resolve, 100));

        expect(mockRemoteServerConfigCtr.refreshAccessToken).not.toHaveBeenCalled();
      });

      it('should refresh on startup when token is expired regardless of last refresh time', async () => {
        // Token expired 1 hour ago
        vi.mocked(mockRemoteServerConfigCtr.getTokenExpiresAt).mockReturnValue(
          Date.now() - 60 * 60 * 1000,
        );
        // Last refresh was 2 minutes ago (within debounce, but token is expired)
        vi.mocked(mockRemoteServerConfigCtr.getLastTokenRefreshAt).mockReturnValue(
          Date.now() - 2 * 60 * 1000,
        );
        vi.mocked(mockRemoteServerConfigCtr.refreshAccessToken).mockResolvedValue({
          success: true,
        });

        authCtr.afterAppReady();

        // Wait for async initialization
        await new Promise((resolve) => setTimeout(resolve, 100));

        expect(mockRemoteServerConfigCtr.refreshAccessToken).toHaveBeenCalled();
      });
    });

    describe('refresh debounce boundary tests', () => {
      it('should NOT refresh at exactly 5 minutes minus 1 second', async () => {
        // Last refresh was 4 minutes 59 seconds ago
        vi.mocked(mockRemoteServerConfigCtr.getLastTokenRefreshAt).mockReturnValue(
          Date.now() - (FIVE_MINUTES - 1000),
        );

        await authCtr.onAppActivate();

        expect(mockRemoteServerConfigCtr.refreshAccessToken).not.toHaveBeenCalled();
      });

      it('should refresh at exactly 5 minutes', async () => {
        // Last refresh was exactly 5 minutes ago
        vi.mocked(mockRemoteServerConfigCtr.getLastTokenRefreshAt).mockReturnValue(
          Date.now() - FIVE_MINUTES,
        );
        vi.mocked(mockRemoteServerConfigCtr.refreshAccessToken).mockResolvedValue({
          success: true,
        });

        await authCtr.onAppActivate();

        expect(mockRemoteServerConfigCtr.refreshAccessToken).toHaveBeenCalled();
      });
    });
  });
});
