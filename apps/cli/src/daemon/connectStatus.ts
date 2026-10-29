import { CLI_PRIMARY_BIN } from '../constants/identity';
import type { ConnectServiceStatus } from '../service/status';
import { getServiceRestartCommand, readConnectServices } from '../service/status';
import type { DaemonStatus } from './manager';
import { getRunningDaemonPid, readStatus } from './manager';

export interface ConnectRuntime {
  manager: 'daemon' | 'system' | 'user';
  pid: number | null;
  restartCommand: string;
  service?: ConnectServiceStatus;
  status?: DaemonStatus;
}

export async function readConnectRuntimes() {
  const inspection = await readConnectServices();
  const status = readStatus();
  const pid = getRunningDaemonPid();
  const runtimes: ConnectRuntime[] = inspection.services.map((service) => ({
    manager: service.scope,
    pid: service.mainPid,
    restartCommand: getServiceRestartCommand(service),
    service,
    // A status left by another process must not supply this service's version or connection state.
    status: service.mainPid && status?.pid === service.mainPid ? status : undefined,
  }));
  if (pid && !runtimes.some((runtime) => runtime.pid === pid)) {
    runtimes.unshift({
      manager: 'daemon',
      pid,
      restartCommand: `${CLI_PRIMARY_BIN} connect restart`,
      status: status?.pid === pid ? status : undefined,
    });
  }
  return { runtimes, unavailableScopes: inspection.unavailableScopes };
}
