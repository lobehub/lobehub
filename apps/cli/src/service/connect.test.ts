import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const tmpDir = path.join(os.tmpdir(), `lobehub-connect-service-test-${process.pid}`);
const unitDir = path.join(tmpDir, 'systemd-user');
const entryPath = path.join(tmpDir, 'lh.js');

const execFileSyncMock = vi.hoisted(() => vi.fn());
const getRunningDaemonPidMock = vi.hoisted(() => vi.fn());
const loadCredentialsMock = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<Record<string, any>>();
  return { ...actual, execFileSync: execFileSyncMock };
});

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<Record<string, any>>();
  return {
    ...actual,
    default: {
      ...actual.default,
      homedir: () => tmpDir,
    },
  };
});

vi.mock('../auth/credentials', () => ({
  loadCredentials: loadCredentialsMock,
}));

vi.mock('../daemon/manager', () => ({
  getRunningDaemonPid: getRunningDaemonPidMock,
}));

// eslint-disable-next-line import-x/first
import { installConnectService, readConnectServiceStatus, startConnectService } from './connect';

describe('connect service', () => {
  const originalArgv1 = process.argv[1];
  const originalEnv = { ...process.env };
  let systemctlCalls: string[][];

  beforeEach(() => {
    systemctlCalls = [];
    fs.rmSync(tmpDir, { force: true, recursive: true });
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(entryPath, '');

    process.argv[1] = entryPath;
    process.env = {
      ...originalEnv,
      HOME: tmpDir,
      LOBEHUB_CONNECT_SERVICE_UNIT_DIR: unitDir,
    };
    delete process.env.LOBEHUB_CLI_HOME;
    delete process.env.LOBEHUB_CLI_API_KEY;
    delete process.env.LOBEHUB_JWT;

    getRunningDaemonPidMock.mockReturnValue(null);
    loadCredentialsMock.mockReturnValue({ accessToken: 'jwt' });
    execFileSyncMock.mockImplementation((command: string, args: string[]) => {
      if (command !== 'systemctl') throw new Error(`unexpected command: ${command}`);

      systemctlCalls.push(args);
      if (args[0] === '--version') return 'systemd 255';
      if (args[0] !== '--user') return '';

      const systemctlArgs = args.slice(1);
      if (systemctlArgs[0] === 'show-environment') return '';
      if (systemctlArgs[0] === 'show') {
        const propertyArg = systemctlArgs.find((arg) => arg.startsWith('--property='));
        const property = propertyArg?.replace('--property=', '');
        if (property === 'ActiveState') return 'active';
        if (property === 'UnitFileState') return 'enabled';
        if (property === 'SubState') return 'running';
        if (property === 'MainPID') return '1234';
      }

      return '';
    });
  });

  afterEach(() => {
    process.argv[1] = originalArgv1;
    process.env = { ...originalEnv };
    fs.rmSync(tmpDir, { force: true, recursive: true });
    vi.clearAllMocks();
  });

  it('installs and starts the user systemd service', () => {
    installConnectService();

    const unitPath = path.join(unitDir, 'lobehub-connect.service');
    expect(fs.existsSync(unitPath)).toBe(true);
    expect(fs.readFileSync(unitPath, 'utf8')).toContain(
      `"${process.execPath}" "${entryPath}" "connect" "--service-child"`,
    );
    expect(systemctlCalls).toContainEqual(['--user', 'daemon-reload']);
    expect(systemctlCalls).toContainEqual(['--user', 'enable', '--now', 'lobehub-connect.service']);
  });

  it('does not install when a managed connect daemon is already running', () => {
    getRunningDaemonPidMock.mockReturnValue(12345);

    expect(() => installConnectService()).toThrow(
      'Background connect daemon is already running (PID 12345).',
    );
    expect(fs.existsSync(path.join(unitDir, 'lobehub-connect.service'))).toBe(false);
    expect(systemctlCalls).not.toContainEqual([
      '--user',
      'enable',
      '--now',
      'lobehub-connect.service',
    ]);
  });

  it('does not install when no auth is available', () => {
    loadCredentialsMock.mockReturnValue(null);

    expect(() => installConnectService()).toThrow("No authentication found. Run 'lh login' first");
    expect(fs.existsSync(path.join(unitDir, 'lobehub-connect.service'))).toBe(false);
    expect(systemctlCalls).not.toContainEqual([
      '--user',
      'enable',
      '--now',
      'lobehub-connect.service',
    ]);
  });

  it('imports the current environment by name and clears stale service env', () => {
    process.env.LOBEHUB_CLI_API_KEY = 'test-key';
    delete process.env.LOBEHUB_CLI_HOME;

    installConnectService();

    expect(systemctlCalls).toContainEqual(
      expect.arrayContaining(['--user', 'unset-environment', 'LOBEHUB_CLI_HOME']),
    );
    expect(systemctlCalls).toContainEqual(
      expect.arrayContaining(['--user', 'import-environment', 'LOBEHUB_CLI_API_KEY']),
    );
    expect(systemctlCalls).not.toContainEqual(['--user', 'import-environment']);
  });

  it('returns null status when the unit file is not installed', () => {
    expect(readConnectServiceStatus()).toBeNull();
  });

  it('starts an installed service after preflight checks pass', () => {
    installConnectService();
    systemctlCalls = [];

    expect(startConnectService()).toBe(true);

    expect(systemctlCalls).toContainEqual(['--user', 'start', 'lobehub-connect.service']);
  });
});
