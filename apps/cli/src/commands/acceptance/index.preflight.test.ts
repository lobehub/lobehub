import fs from 'node:fs';

import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clearCredentials, saveCredentials } from '../../auth/credentials';
import { credentialsPath } from '../../auth/source';

vi.mock('../../settings', () => ({
  loadActiveWorkspace: () => undefined,
  resolveServerUrl: () => 'https://acceptance.example.test',
}));
vi.unmock('../../utils/logger');

let output: ReturnType<typeof vi.spyOn>;
let errors: ReturnType<typeof vi.spyOn>;

const run = async () => {
  const { registerAcceptanceCommands } = await import('.');
  const program = new Command().exitOverride();
  registerAcceptanceCommands(program);
  await program.parseAsync(['node', 'lh', 'acceptance', 'preflight', '--json']);
  return JSON.parse(String(output.mock.calls.at(-1)?.[0]));
};

beforeEach(() => {
  vi.resetModules();
  clearCredentials();
  vi.stubEnv('LOBEHUB_JWT', '');
  vi.stubEnv('LOBEHUB_CLI_API_KEY', '');
  vi.stubEnv('LOBEHUB_WORKSPACE_ID', 'personal');
  output = vi.spyOn(console, 'log').mockImplementation(() => {});
  errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(process, 'exit').mockImplementation((code) => {
    throw new Error(`process.exit(${code})`);
  });
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network unavailable')));
});

afterEach(() => {
  clearCredentials();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('acceptance preflight', () => {
  it('selects offline reports when no credentials exist', async () => {
    expect(await run()).toMatchObject({
      authenticated: false,
      language: { status: 'unset' },
      mode: 'local',
    });
  });

  it.each(['expired', 'undated', 'corrupt'])(
    'stops with a login remedy instead of silently selecting local mode for %s credentials',
    async (state) => {
      saveCredentials({
        accessToken: 'fixture-access-token',
        expiresAt: state === 'expired' ? 1 : undefined,
      });
      if (state === 'corrupt') fs.writeFileSync(credentialsPath(), 'unreadable-credentials');

      await expect(run()).rejects.toThrow('process.exit(1)');
      expect(output.mock.calls).toEqual([]);
      expect(errors.mock.calls.flat().join(' ')).toContain('lh login');
      expect(fs.existsSync(credentialsPath())).toBe(true);
    },
  );

  it.each(['stored', 'jwt', 'apiKey'])(
    'keeps publishing with valid %s credentials and the account language',
    async (source) => {
      if (source === 'stored') {
        saveCredentials({
          accessToken: 'fixture-access-token',
          expiresAt: Math.floor(Date.now() / 1000) + 3600,
        });
      } else {
        vi.stubEnv(source === 'jwt' ? 'LOBEHUB_JWT' : 'LOBEHUB_CLI_API_KEY', 'fixture-token');
      }
      vi.mocked(fetch).mockResolvedValue(
        new Response(
          JSON.stringify({
            result: { data: { json: { settings: { general: { responseLanguage: 'zh-CN' } } } } },
          }),
          { headers: { 'Content-Type': 'application/json' } },
        ),
      );

      expect(await run()).toMatchObject({
        authenticated: true,
        language: { locale: 'zh-CN', status: 'enforced' },
        mode: 'publish',
      });
    },
  );

  it('surfaces an unavailable refresh without changing mode or removing the stored login', async () => {
    saveCredentials({
      accessToken: 'expired-token',
      expiresAt: 1,
      refreshToken: 'fixture-refresh',
    });
    const stored = fs.readFileSync(credentialsPath(), 'utf8');

    await expect(run()).rejects.toThrow('process.exit(1)');
    expect(output.mock.calls).toEqual([]);
    expect(errors.mock.calls.flat().join(' ')).toContain('Retry in a moment');
    expect(fs.readFileSync(credentialsPath(), 'utf8')).toBe(stored);
  });
});
