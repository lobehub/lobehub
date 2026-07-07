import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { loadCredentials } from '../auth/credentials';
import { CLI_API_KEY_ENV } from '../constants/auth';
import { getRunningDaemonPid } from '../daemon/manager';

const SERVICE_NAME = 'lobehub-connect.service';
const ENV_NAME_PATTERN = /^[A-Z_]\w*$/i;
const SERVICE_ENV_NAMES = [
  'AGENT_GATEWAY_URL',
  'DEBUG',
  'LH_GATEWAY_URL',
  'LOBEHUB_CLI_CHANNEL',
  'LOBEHUB_CLI_HOME',
  CLI_API_KEY_ENV,
  'LOBEHUB_JWT',
  'LOBEHUB_SERVER',
];

export interface ConnectServiceStatus {
  active: boolean;
  enabled: boolean;
  installed: boolean;
  mainPid: number | null;
  serviceName: string;
  subState: string | null;
  unitFileState: string | null;
}

function systemctl(args: string[], stdio: 'pipe' | 'inherit' = 'pipe'): string {
  const output = execFileSync('systemctl', ['--user', ...args], {
    encoding: 'utf8',
    stdio: ['ignore', stdio, stdio === 'pipe' ? 'pipe' : 'inherit'],
  });

  return typeof output === 'string' ? output.trim() : '';
}

function getUserServiceDir(): string {
  return (
    process.env.LOBEHUB_CONNECT_SERVICE_UNIT_DIR ||
    path.join(os.homedir(), '.config', 'systemd', 'user')
  );
}

function getExecErrorMessage(error: unknown): string {
  const stderr =
    error && typeof error === 'object' && 'stderr' in error
      ? String((error as { stderr?: Buffer | string }).stderr || '').trim()
      : '';
  if (stderr) return stderr;
  return error instanceof Error ? error.message : String(error);
}

function renderUnit(): string {
  const quoteSystemdValue = (value: string): string =>
    `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
  const escapeSystemdEnvValue = (value: string): string =>
    value.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
  const homeDir = os.homedir();
  const cliHomeDir = path.join(homeDir, process.env.LOBEHUB_CLI_HOME || '.lobehub');
  const logPath = path.join(cliHomeDir, 'daemon.log');
  const scriptPath = fs.realpathSync(process.argv[1]!);
  const execStart = [process.execPath, scriptPath, 'connect', '--service-child']
    .map(quoteSystemdValue)
    .join(' ');

  return [
    '[Unit]',
    'Description=LobeHub CLI connect service',
    'After=network-online.target',
    'Wants=network-online.target',
    'StartLimitIntervalSec=60',
    'StartLimitBurst=10',
    '',
    '[Service]',
    'Type=simple',
    `WorkingDirectory=${homeDir}`,
    `Environment=HOME=${escapeSystemdEnvValue(homeDir)}`,
    'Environment=LOBEHUB_CONNECT_SERVICE=1',
    `ExecStart=${execStart}`,
    `StandardOutput=append:${logPath}`,
    `StandardError=append:${logPath}`,
    'Restart=on-failure',
    'SuccessExitStatus=0 1 2',
    'RestartSec=1',
    'TimeoutStopSec=20',
    '',
    '[Install]',
    'WantedBy=default.target',
    '',
  ].join('\n');
}

function requireLinuxSystemd() {
  if (process.platform !== 'linux') {
    throw new Error('Connect service install is currently Linux-only.');
  }
  try {
    execFileSync('systemctl', ['--version'], { stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    throw new Error(`systemctl is not available on this system: ${getExecErrorMessage(error)}`, {
      cause: error,
    });
  }
  try {
    systemctl(['show-environment']);
  } catch (error) {
    throw new Error(
      [
        'Linux user systemd is not available.',
        'Make sure `systemctl --user ...` works for this user.',
        'On Debian/Ubuntu minimal systems, install `libpam-systemd` and `dbus-user-session`, then start a user session or enable linger.',
        getExecErrorMessage(error),
      ].join(' '),
      { cause: error },
    );
  }
}

function importServiceEnvironment(): void {
  const staleServiceEnvNames = SERVICE_ENV_NAMES.filter((name) => process.env[name] === undefined);
  if (staleServiceEnvNames.length > 0) {
    systemctl(['unset-environment', ...staleServiceEnvNames], 'inherit');
  }

  const environmentNames = Object.keys(process.env).filter((name) => ENV_NAME_PATTERN.test(name));
  if (environmentNames.length > 0) {
    systemctl(['import-environment', ...environmentNames], 'inherit');
  }
}

function assertNoConnectDaemonRunning(): void {
  const daemonPid = getRunningDaemonPid();
  if (daemonPid === null) return;

  throw new Error(
    [
      `Background connect daemon is already running (PID ${daemonPid}).`,
      'Stop it before starting the systemd service.',
      'Run `lh connect stop`, then retry this command.',
    ].join(' '),
  );
}

function assertConnectServiceAuthAvailable(): void {
  if (process.env.LOBEHUB_JWT || process.env[CLI_API_KEY_ENV] || loadCredentials()) return;

  throw new Error(
    `No authentication found. Run 'lh login' first, or set ${CLI_API_KEY_ENV} before starting the connect service.`,
  );
}

export function installConnectService(): void {
  requireLinuxSystemd();
  assertNoConnectDaemonRunning();
  assertConnectServiceAuthAvailable();

  fs.mkdirSync(path.join(os.homedir(), process.env.LOBEHUB_CLI_HOME || '.lobehub'), {
    mode: 0o700,
    recursive: true,
  });
  fs.mkdirSync(getUserServiceDir(), { mode: 0o700, recursive: true });
  fs.writeFileSync(path.join(getUserServiceDir(), SERVICE_NAME), renderUnit(), { mode: 0o644 });

  importServiceEnvironment();
  systemctl(['daemon-reload'], 'inherit');
  systemctl(['enable', '--now', SERVICE_NAME], 'inherit');
}

export function uninstallConnectService(): boolean {
  const unitPath = path.join(getUserServiceDir(), SERVICE_NAME);
  if (!fs.existsSync(unitPath)) return false;

  requireLinuxSystemd();

  try {
    systemctl(['disable', '--now', SERVICE_NAME], 'inherit');
  } catch {
    // Best effort: remove the unit file even when the service is already stopped.
  }

  fs.unlinkSync(unitPath);
  systemctl(['daemon-reload'], 'inherit');

  return true;
}

export function startConnectService(): boolean {
  if (!fs.existsSync(path.join(getUserServiceDir(), SERVICE_NAME))) return false;
  requireLinuxSystemd();
  assertNoConnectDaemonRunning();
  assertConnectServiceAuthAvailable();
  importServiceEnvironment();
  systemctl(['start', SERVICE_NAME], 'inherit');
  return true;
}

export function stopConnectService(): boolean {
  if (!fs.existsSync(path.join(getUserServiceDir(), SERVICE_NAME))) return false;
  requireLinuxSystemd();
  systemctl(['stop', SERVICE_NAME], 'inherit');
  return true;
}

export function restartConnectService(): boolean {
  if (!fs.existsSync(path.join(getUserServiceDir(), SERVICE_NAME))) return false;
  requireLinuxSystemd();
  assertNoConnectDaemonRunning();
  assertConnectServiceAuthAvailable();
  importServiceEnvironment();
  systemctl(['restart', SERVICE_NAME], 'inherit');
  return true;
}

export function readConnectServiceStatus(): ConnectServiceStatus | null {
  if (!fs.existsSync(path.join(getUserServiceDir(), SERVICE_NAME))) return null;

  requireLinuxSystemd();

  const getShowValue = (property: string): string | null => {
    try {
      return systemctl(['show', SERVICE_NAME, `--property=${property}`, '--value']);
    } catch {
      return null;
    }
  };
  const activeState = getShowValue('ActiveState');
  const unitFileState = getShowValue('UnitFileState');
  const subState = getShowValue('SubState');
  const mainPidRaw = getShowValue('MainPID');

  return {
    active: activeState === 'active',
    enabled: unitFileState === 'enabled',
    installed: true,
    mainPid: mainPidRaw && mainPidRaw !== '0' ? Number.parseInt(mainPidRaw, 10) : null,
    serviceName: SERVICE_NAME,
    subState,
    unitFileState,
  };
}
