import { execFile } from 'node:child_process';

import { CLI_CONNECT_SERVICE_NAME } from '../constants/identity';

type ServiceScope = 'system' | 'user';

export interface ConnectServiceStatus {
  active: boolean;
  enabled: boolean;
  fragmentPath: string | null;
  mainPid: number | null;
  /** systemd `Restart=` policy, plus the exit statuses that override it. */
  restart: string | null;
  restartPreventExitStatus: string[];
  scope: ServiceScope;
  serviceName: string;
  subState: string | null;
  successExitStatus: string[];
  user: string | null;
}

const splitStatuses = (value: string | undefined) => value?.split(/\s+/).filter(Boolean) ?? [];

/** Read both managers independently: an unavailable user bus does not hide a system service. */
export async function readConnectServices() {
  if (process.platform !== 'linux') return { services: [], unavailableScopes: [] };

  const scopes: ServiceScope[] = ['user', 'system'];
  const results = await Promise.allSettled(
    scopes.map(async (scope) => {
      // Query only public service metadata, never ExecStart or Environment (which may contain tokens).
      const stdout = await new Promise<string>((resolve, reject) => {
        execFile(
          'systemctl',
          [
            `--${scope}`,
            'show',
            CLI_CONNECT_SERVICE_NAME,
            '--property=LoadState,ActiveState,SubState,UnitFileState,MainPID,FragmentPath,User,Restart,RestartPreventExitStatus,SuccessExitStatus',
          ],
          { encoding: 'utf8', timeout: 3000 },
          (error, output) => {
            if (error && !output.split('\n').includes('LoadState=not-found')) reject(error);
            else resolve(output);
          },
        );
      });
      const values = Object.fromEntries(
        stdout
          .trim()
          .split('\n')
          .map((line) => {
            const separator = line.indexOf('=');
            return [line.slice(0, separator), line.slice(separator + 1)];
          }),
      );
      if (values.LoadState === 'not-found') return null;
      if (!values.LoadState) throw new Error('systemctl did not report the unit load state');

      const pid = Number(values.MainPID);
      return {
        active: values.ActiveState === 'active',
        enabled: values.UnitFileState === 'enabled',
        fragmentPath: values.FragmentPath || null,
        mainPid: Number.isSafeInteger(pid) && pid > 0 ? pid : null,
        restart: values.Restart || null,
        restartPreventExitStatus: splitStatuses(values.RestartPreventExitStatus),
        scope,
        serviceName: CLI_CONNECT_SERVICE_NAME,
        subState: values.SubState || null,
        successExitStatus: splitStatuses(values.SuccessExitStatus),
        user: values.User || (scope === 'system' ? 'root' : null),
      } satisfies ConnectServiceStatus;
    }),
  );

  const services: ConnectServiceStatus[] = [];
  const unavailableScopes: ServiceScope[] = [];
  results.forEach((result, index) => {
    if (result.status === 'rejected') unavailableScopes.push(scopes[index]);
    else if (result.value) services.push(result.value);
  });
  return { services, unavailableScopes };
}

/** Whether systemd starts the unit again after its main process exits with `code`. */
export function serviceRestartsAfterExit(service: ConnectServiceStatus, code: number): boolean {
  const status = String(code);
  if (service.restartPreventExitStatus.includes(status)) return false;
  if (service.restart === 'always') return true;
  return service.restart === 'on-failure' && !service.successExitStatus.includes(status);
}

export function getServiceRestartCommand(service: ConnectServiceStatus): string {
  const manager = service.scope === 'system' ? 'sudo systemctl' : 'systemctl --user';
  // A terminal opened through the connector belongs to the service too. Queue the restart
  // without waiting for systemd to stop the very terminal executing this command.
  return `${manager} --no-block restart ${service.serviceName}`;
}
