import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CONNECT_RETRYABLE_EXIT_CODE,
  getWorkspaceFailureExitCode,
  installConnectService,
  readConnectServiceStatus,
  startConnectService,
} from './connect';

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

describe('connect service', () => {
  const originalArgv1 = process.argv[1];
  const originalEnv = { ...process.env };
  let systemctlCalls: string[][];

  beforeEach(() => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('linux');

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
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.AWS_SECRET_ACCESS_KEY;

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
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('installs and starts the user systemd service', () => {
    installConnectService();

    const unitPath = path.join(unitDir, 'lobehub-connect.service');
    expect(fs.existsSync(unitPath)).toBe(true);
    expect(fs.readFileSync(unitPath, 'utf8')).toContain(
      `"${process.execPath}" "${fs.realpathSync(entryPath)}" "connect" "--service-child"`,
    );
    expect(fs.readFileSync(unitPath, 'utf8')).toContain(
      `EnvironmentFile=${path.join(tmpDir, '.lobehub', 'connect-service.env')}`,
    );
    expect(systemctlCalls).toContainEqual(['--user', 'daemon-reload']);
    expect(systemctlCalls).toContainEqual(['--user', 'enable', 'lobehub-connect.service']);
    expect(systemctlCalls).toContainEqual(['--user', 'restart', 'lobehub-connect.service']);
  });

  it('passes workspace enrollment flags to the service child', () => {
    installConnectService({ public: true, workspace: 'ws_123' });

    expect(fs.readFileSync(path.join(unitDir, 'lobehub-connect.service'), 'utf8')).toContain(
      `"${process.execPath}" "${fs.realpathSync(entryPath)}" "connect" "--service-child" "--workspace" "ws_123" "--public"`,
    );
  });

  it('rejects --public without --workspace', () => {
    expect(() => installConnectService({ public: true })).toThrow('--public requires --workspace.');
    expect(fs.existsSync(path.join(unitDir, 'lobehub-connect.service'))).toBe(false);
  });

  it('does not install when a managed connect daemon is already running', () => {
    getRunningDaemonPidMock.mockReturnValue(12345);

    expect(() => installConnectService()).toThrow(
      'Background connect daemon is already running (PID 12345).',
    );
    expect(fs.existsSync(path.join(unitDir, 'lobehub-connect.service'))).toBe(false);
    expect(systemctlCalls).not.toContainEqual(['--user', 'enable', 'lobehub-connect.service']);
  });

  it('does not install when no auth is available', () => {
    loadCredentialsMock.mockReturnValue(null);

    expect(() => installConnectService()).toThrow("No authentication found. Run 'lh login' first");
    expect(fs.existsSync(path.join(unitDir, 'lobehub-connect.service'))).toBe(false);
    expect(systemctlCalls).not.toContainEqual(['--user', 'enable', 'lobehub-connect.service']);
  });

  it('writes the current environment to a service-scoped env file', () => {
    process.env.ANTHROPIC_API_KEY = 'anthropic-key';
    process.env.AWS_SECRET_ACCESS_KEY = 'aws-secret';
    process.env.LOBEHUB_CLI_API_KEY = 'test-key';
    process.env.QUOTED_ENV = 'value with "quotes", \\slashes, and $dollars';

    installConnectService();

    const envFilePath = path.join(tmpDir, '.lobehub', 'connect-service.env');
    const envFile = fs.readFileSync(envFilePath, 'utf8');
    expect(fs.statSync(envFilePath).mode & 0o777).toBe(0o600);
    expect(envFile).toContain('ANTHROPIC_API_KEY="anthropic-key"');
    expect(envFile).toContain('AWS_SECRET_ACCESS_KEY="aws-secret"');
    expect(envFile).toContain('LOBEHUB_CLI_API_KEY="test-key"');
    expect(envFile).toContain('QUOTED_ENV="value with \\"quotes\\", \\\\slashes, and \\$dollars"');
    expect(systemctlCalls.some((call) => call.includes('import-environment'))).toBe(false);
    expect(systemctlCalls.some((call) => call.includes('unset-environment'))).toBe(false);
    expect(systemctlCalls).not.toContainEqual(['--user', 'import-environment']);
  });

  it('returns null status when the unit file is not installed', () => {
    expect(readConnectServiceStatus()).toBeNull();
  });

  it('starts an installed service after preflight checks pass', () => {
    installConnectService();
    systemctlCalls = [];
    process.env.LOBEHUB_CLI_API_KEY = 'rotated-key';

    expect(startConnectService()).toBe(true);

    expect(fs.readFileSync(path.join(tmpDir, '.lobehub', 'connect-service.env'), 'utf8')).toContain(
      'LOBEHUB_CLI_API_KEY="rotated-key"',
    );
    expect(systemctlCalls).toContainEqual(['--user', 'start', 'lobehub-connect.service']);
  });

  describe('getWorkspaceFailureExitCode', () => {
    it('lets systemd retry transient workspace startup failures', () => {
      expect(getWorkspaceFailureExitCode(new Error('fetch failed'))).toBe(
        CONNECT_RETRYABLE_EXIT_CODE,
      );
      expect(getWorkspaceFailureExitCode({ data: { code: 'INTERNAL_SERVER_ERROR' } })).toBe(
        CONNECT_RETRYABLE_EXIT_CODE,
      );
    });

    it('stops on server refusals that a restart cannot fix', () => {
      expect(getWorkspaceFailureExitCode({ data: { code: 'CONFLICT' } })).toBe(1);
      expect(getWorkspaceFailureExitCode({ data: { code: 'FORBIDDEN' } })).toBe(1);
    });

    it('keeps the retryable code outside the unit success exit statuses', () => {
      installConnectService({ workspace: 'ws_123' });
      const unit = fs.readFileSync(path.join(unitDir, 'lobehub-connect.service'), 'utf8');
      const successCodes = unit.match(/^SuccessExitStatus=(.*)$/m)![1].split(' ');
      expect(successCodes).not.toContain(String(CONNECT_RETRYABLE_EXIT_CODE));
      expect(unit).toContain('Restart=on-failure');
      // A start-rate limit would stop the retries after a burst of failures.
      expect(unit).toContain('StartLimitIntervalSec=0');
      expect(unit).not.toContain('StartLimitBurst');
    });
  });
});
