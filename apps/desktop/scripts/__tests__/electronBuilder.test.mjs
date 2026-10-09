import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Loading the packaging config must not read local release credentials or load
// the ASAR packer: these tests inspect metadata without running build hooks.
vi.mock('dotenv', () => ({ default: { config: vi.fn() } }));
vi.mock('../packBuiltinCore.mjs', () => ({ packBuiltinCore: vi.fn() }));

beforeEach(() => {
  vi.resetModules();
  for (const name of [
    'APPLE_TEAM_ID',
    'CSC_IDENTITY_AUTO_DISCOVERY',
    'CSC_LINK',
    'MAC_PROVISIONING_PROFILE',
    'SPARKLE_ED_PUBLIC_KEY',
    'UPDATE_SERVER_URL',
  ]) {
    vi.stubEnv(name, undefined);
  }
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('macOS packaging metadata', () => {
  it.each([undefined, 'stable', 'canary', 'nightly'])(
    'declares local network usage for the %s channel',
    async (channel) => {
      vi.stubEnv('UPDATE_CHANNEL', channel);
      const { default: config } = await import('../../electron-builder.mjs');

      expect(config.mac.extendInfo.NSLocalNetworkUsageDescription).toMatch(/\S/);
    },
  );
});
