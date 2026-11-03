import { spawn } from 'node:child_process';

import { type ConnectRuntime, readConnectRuntimes } from '../daemon/connectStatus';
import { log } from '../utils/logger';

export interface ConnectRestartOptions {
  agentBrowser?: string;
  auv?: string;
  deviceId?: string;
  gateway?: string;
  manager?: string;
  token?: string;
}

/** Select a single owner before stopping anything; never start a daemon beside a service. */
export async function restartConnector(
  options: ConnectRestartOptions,
  restartDaemon: () => Promise<void>,
) {
  const fail = (message: string) => {
    log.error(message);
    process.exitCode = 1;
  };
  if (options.manager && !['daemon', 'user', 'system'].includes(options.manager)) {
    fail('Unknown manager. Use --manager daemon, user, or system.');
    return;
  }
  const { runtimes, unavailableScopes } = await readConnectRuntimes();
  if (options.manager && unavailableScopes.includes(options.manager as 'user' | 'system')) {
    fail(`Cannot inspect the ${options.manager} systemd manager. No restart was requested.`);
    return;
  }
  // An unseen service could also own this device. Require an explicit choice rather than guessing.
  if (!options.manager && unavailableScopes.includes('system')) {
    fail('Cannot inspect system services. Run lh connect status --verbose, then choose --manager.');
    return;
  }
  const matching = runtimes.filter(
    (runtime) => !options.manager || runtime.manager === options.manager,
  );
  const running = matching.filter((runtime) => runtime.pid || runtime.service?.active);
  const candidates = running.length ? running : matching;
  if (candidates.length > 1) {
    fail(
      'Multiple connectors found. Choose one with lh connect restart --manager daemon|user|system.',
    );
    return;
  }
  const target = candidates[0];
  if (!target) {
    if (options.manager || unavailableScopes.length) {
      fail(
        'No connector found in the selected/available manager. Run lh connect status --verbose.',
      );
      return;
    }
    // Preserve the existing restart-as-start behavior when no managed connector exists.
    await restartDaemon();
    return;
  }
  if (
    target.manager === 'daemon' &&
    runtimes.some((runtime) => runtime.service && (runtime.service.active || runtime.pid))
  ) {
    fail(
      'A systemd connect service is also running. Stop that service before restarting the daemon. No connector was stopped.',
    );
    return;
  }
  if (
    target.service &&
    [options.token, options.gateway, options.deviceId, options.auv, options.agentBrowser].some(
      Boolean,
    )
  ) {
    fail(
      'Connection options cannot override a systemd service. Update its configuration before restarting.',
    );
    return;
  }

  log.warn(
    'Restarting disconnects the device and closes its remote terminals. Wait for active tasks to finish.',
  );
  log.info('If this terminal is provided by LobeHub, it may close or show "Terminated".');
  log.info(
    "After reconnecting, run 'lh connect status' to confirm the running version and connection.",
  );
  if (!target.service) {
    log.info('Waiting for the previous daemon to exit before starting its replacement...');
    await restartDaemon();
    return;
  }
  log.info(`Requesting restart of the ${target.manager}-level connect service...`);
  try {
    await requestServiceRestart(target);
    log.info(
      'Restart requested. The service may still be starting; this does not confirm a connection.',
    );
  } catch {
    fail(
      `Could not request the restart. Check permissions and service status, or run: ${target.restartCommand}`,
    );
  }
}

function requestServiceRestart(runtime: ConnectRuntime): Promise<void> {
  const system = runtime.manager === 'system';
  const sudo = system && process.getuid?.() !== 0;
  const command = sudo ? 'sudo' : 'systemctl';
  const args = [
    ...(sudo ? ['systemctl'] : []),
    system ? '--system' : '--user',
    '--no-block',
    'restart',
    runtime.service!.serviceName,
  ];
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit' });
    child.once('error', reject);
    child.once('close', (code) =>
      code === 0 ? resolve() : reject(new Error('Restart request failed')),
    );
  });
}
