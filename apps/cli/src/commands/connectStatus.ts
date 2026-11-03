import { type ConnectRuntime, readConnectRuntimes } from '../daemon/connectStatus';
import { cliVersion } from '../pkg';
import { log } from '../utils/logger';

/** Why a running connector may not be executing the installed CLI. Empty when it is. */
export function describeStaleConnector(
  runtime: ConnectRuntime,
  installedVersion: string,
): string[] {
  const { pid, status } = runtime;
  if (!pid || status?.cliVersion === installedVersion) return [];
  return [
    status?.cliVersion
      ? `Connector PID ${pid} is running ${status.cliVersion}; installed CLI is ${installedVersion}.`
      : `Connector PID ${pid} did not report its version. The installed CLI version does not confirm the running version.`,
    `Installing an update does not reload a running connector. After active tasks finish, run: ${runtime.restartCommand}`,
    'Restarting disconnects the device and closes its remote terminals. If the version still differs, check the service uses the upgraded CLI installation.',
  ];
}

/**
 * Only the mismatch warnings, for commands whose own output is about something else. An
 * update from a CLI that predates the connector report leaves this as the first notice.
 */
export async function warnStaleConnectors() {
  const { runtimes } = await readConnectRuntimes();
  for (const runtime of runtimes) {
    for (const line of describeStaleConnector(runtime, cliVersion)) log.warn(line);
  }
}

/** Shared by status and update, including when the installed CLI is already current. */
export async function printConnectStatus(
  options: {
    installedVersion?: string;
    servicesOnly?: boolean;
  } = {},
) {
  const installedVersion = options.installedVersion ?? cliVersion;
  const { runtimes, unavailableScopes } = await readConnectRuntimes();
  const selected = runtimes.filter((runtime) => !options.servicesOnly || runtime.service);
  log.info(`Installed CLI version (this command): ${installedVersion}`);
  for (const scope of unavailableScopes) {
    log.warn(`Could not inspect ${scope} systemd services. Check 'systemctl --${scope} status'.`);
  }
  if (selected.length === 0) {
    log.info(
      unavailableScopes.length
        ? 'No managed connector found in the available managers; service status is incomplete.'
        : options.servicesOnly
          ? 'No user-level or system-level connect service found.'
          : 'No managed connect daemon or service found. Foreground connections are not included.',
    );
    return;
  }

  for (const runtime of selected) {
    const { pid, service, status } = runtime;
    log.info(
      runtime.manager === 'daemon' ? '─── Daemon Status ───' : '─── Connect Service Status ───',
    );
    log.info(
      `  Manager          : ${runtime.manager === 'daemon' ? 'CLI daemon' : `${runtime.manager}-level systemd`}`,
    );
    if (service) {
      log.info(`  Service          : ${service.serviceName}`);
      log.info(`  Unit             : ${service.fragmentPath || 'unknown'}`);
      log.info(`  User             : ${service.user || 'current user'}`);
      log.info(`  Enabled          : ${service.enabled ? 'yes' : 'no'}`);
      log.info(`  Active           : ${service.active ? 'yes' : 'no'}`);
      log.info(`  Sub-state        : ${service.subState || 'unknown'}`);
    }
    if (pid) {
      log.info(`  PID              : ${pid}`);
      log.info(
        `  Running version  : ${status?.cliVersion || 'unknown (not reported by this process)'}`,
      );
    }
    if (status) {
      log.info(`  Started at       : ${status.startedAt}`);
      log.info(`  Uptime           : ${formatUptime(new Date(status.startedAt))}`);
      log.info(`  Connection       : ${status.connectionStatus}`);
      log.info(
        `  Gateway          : ${status.gatewayUrl}${status.gatewaySource ? ` (${status.gatewaySource})` : ''}`,
      );
    }
    log.info(`  Restart command  : ${runtime.restartCommand}`);
    for (const line of describeStaleConnector(runtime, installedVersion)) log.warn(line);
  }
}

function formatUptime(startedAt: Date): string {
  const diff = Date.now() - startedAt.getTime();
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h ${minutes % 60}m`;
  if (hours > 0) return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}
