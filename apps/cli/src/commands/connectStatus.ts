import { type ConnectRuntime, readConnectRuntimes } from '../daemon/connectStatus';
import { getCliInstallationPath, getConnectorInstallationPath } from '../daemon/installation';
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
    `After active tasks finish, run: lh connect restart --manager ${runtime.manager}`,
    'Restarting disconnects the device and closes its remote terminals. Reconnect and run lh connect status to confirm the update is in use.',
  ];
}

/** Only mismatch warnings, for commands whose own output is about something else. */
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
    verbose?: boolean;
  } = {},
) {
  const installedVersion = options.installedVersion ?? cliVersion;
  const { runtimes, unavailableScopes } = await readConnectRuntimes();
  const selected = runtimes.filter((runtime) => !options.servicesOnly || runtime.service);
  log.info(`Installed CLI version: ${installedVersion}`);
  const hasConnectedSystemService = selected.some(
    (runtime) =>
      runtime.manager === 'system' &&
      runtime.service?.active &&
      runtime.pid &&
      runtime.status?.connectionStatus === 'connected',
  );
  for (const scope of unavailableScopes) {
    // User buses are often unavailable inside service-owned terminals. This is
    // diagnostic detail, not an action for someone whose system service is connected.
    if (scope === 'user' && hasConnectedSystemService) {
      if (options.verbose) {
        log.info(
          'User-level systemd inspection is unavailable. The system-level connect service is running and connected; this does not affect its connection.',
        );
        log.info("Check 'systemctl --user status' to diagnose user-level systemd access.");
      }
    } else {
      log.warn(`Could not inspect ${scope} systemd services. Check 'systemctl --${scope} status'.`);
    }
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

  let currentPath: string | undefined;
  for (const runtime of selected) {
    const { pid, service, status } = runtime;
    const stale = describeStaleConnector(runtime, installedVersion);
    log.info(
      runtime.manager === 'daemon' ? '─── Daemon Status ───' : '─── Connect Service Status ───',
    );
    log.info(
      `  Manager          : ${runtime.manager === 'daemon' ? 'CLI daemon' : `${runtime.manager}-level systemd`}`,
    );
    log.info(`  Connection       : ${pid ? status?.connectionStatus || 'unknown' : 'stopped'}`);
    log.info(
      `  Running version  : ${pid ? status?.cliVersion || 'unknown (not reported by this process)' : 'not running'}${pid && status?.cliVersion === installedVersion ? ' (matches installed CLI)' : ''}`,
    );
    if (options.verbose) {
      if (service) {
        log.info(`  Service          : ${service.serviceName}`);
        log.info(`  Unit             : ${service.fragmentPath || 'unknown'}`);
        log.info(`  User             : ${service.user || 'current user'}`);
        log.info(`  Enabled          : ${service.enabled ? 'yes' : 'no'}`);
        log.info(`  Active           : ${service.active ? 'yes' : 'no'}`);
        log.info(`  Sub-state        : ${service.subState || 'unknown'}`);
      }
      if (pid) log.info(`  PID              : ${pid}`);
      if (status) {
        log.info(`  Started at       : ${status.startedAt}`);
        log.info(`  Uptime           : ${formatUptime(new Date(status.startedAt))}`);
        log.info(
          `  Gateway          : ${status.gatewayUrl}${status.gatewaySource ? ` (${status.gatewaySource})` : ''}`,
        );
      }
      log.info(`  Restart command  : ${runtime.restartCommand}`);
    }
    if (options.verbose || stale.length) {
      currentPath ??= await getCliInstallationPath();
      const connectorPath = pid
        ? await getConnectorInstallationPath(pid, status?.cliPath)
        : undefined;
      log.info(`  CLI path (command): ${currentPath || 'unknown'}`);
      log.info(`  Connector CLI path: ${connectorPath || 'unknown (not reported or accessible)'}`);
      if (currentPath && connectorPath && currentPath !== connectorPath) {
        log.warn(
          service
            ? 'Different CLI installations detected. Restarting keeps the service installation shown above; update that installation or reconfigure the service to use this CLI.'
            : "Different CLI installations detected. Restarting the daemon uses this command's CLI installation.",
        );
      } else if (stale.length) {
        log.info(
          'If the version still differs after restarting, run lh connect status --verbose to check the installation paths.',
        );
      }
    }
    for (const line of stale) log.warn(line);
    if (!pid)
      log.info(`To start this connector, run: lh connect restart --manager ${runtime.manager}`);
  }
  if (!options.verbose) log.info('Details: lh connect status --verbose');
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
