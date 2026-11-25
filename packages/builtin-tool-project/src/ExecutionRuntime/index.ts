import type { BuiltinServerRuntimeOutput } from '@lobechat/types';

import {
  type AddRunnerParams,
  type ProjectToolDevice,
  type ProjectToolEnvironment,
  type ProjectToolRunner,
  type ProjectToolService,
  type RemoveRunnerParams,
  type ReorderRunnersParams,
  SANDBOX_RUNNER_ID,
  type UpdateEnvironmentParams,
} from '../types';

const formatRunner = (runner: ProjectToolRunner, index: number) => {
  const mark = runner.current ? ' ← this conversation' : '';
  if (runner.kind === 'sandbox') return `${index + 1}. ${SANDBOX_RUNNER_ID} · cloud sandbox${mark}`;
  const presence =
    runner.online === undefined ? 'presence unknown' : runner.online ? 'online' : 'offline';
  const device = `${runner.deviceName || runner.deviceId || 'device'}${runner.platform ? ` (${runner.platform})` : ''}`;
  const pending = runner.runnable === false ? ' · not confirmed on the device yet' : '';
  return `${index + 1}. ${runner.id} · ${device} · ${presence} · ${runner.path}${pending}${mark}`;
};

const formatRunners = (runners: ProjectToolRunner[]) =>
  ['Runners, in priority order:', ...runners.map(formatRunner)].join('\n');

const formatDevices = (devices: ProjectToolDevice[]) =>
  devices.length === 0
    ? 'No devices are connected to this account or workspace.'
    : [
        'Devices that can be added as runners:',
        ...devices.map(
          (device) =>
            `- ${device.deviceId} · ${device.name}${device.platform ? ` (${device.platform})` : ''} · ${device.online ? 'online' : 'offline'}`,
        ),
      ].join('\n');

export const formatEnvironment = (environment: ProjectToolEnvironment) =>
  [
    'Repositories:',
    ...(environment.repositories.length === 0
      ? ['(none)']
      : environment.repositories.map(
          (repository) =>
            `- ${repository.url}${repository.ref ? ` @${repository.ref}` : ''}${repository.folder ? ` → ${repository.folder}` : ''}${repository.setupCommand ? ` · setup: ${repository.setupCommand}` : ''}`,
        )),
    `Setup command: ${environment.bootstrapCommand || '(none)'}`,
    `Variables (cloud sandbox only): ${environment.envNames.join(', ') || '(none)'}`,
    `Run notes: ${environment.notes || '(none)'}`,
  ].join('\n');

const failure = (error: unknown): BuiltinServerRuntimeOutput => {
  const message = error instanceof Error ? error.message : String(error);
  return { content: message, error: { message, type: 'PROJECT_TOOL_ERROR' }, success: false };
};

export class ProjectExecutionRuntime {
  constructor(private service: ProjectToolService) {}

  async listRunners(): Promise<BuiltinServerRuntimeOutput> {
    try {
      const { devices, runners } = await this.service.listRunners();
      return {
        content: `${formatRunners(runners)}\n\n${formatDevices(devices)}`,
        state: { runners },
        success: true,
      };
    } catch (error) {
      return failure(error);
    }
  }

  async getEnvironment(): Promise<BuiltinServerRuntimeOutput> {
    try {
      const environment = await this.service.getEnvironment();
      return { content: formatEnvironment(environment), state: { environment }, success: true };
    } catch (error) {
      return failure(error);
    }
  }

  async updateEnvironment(params: UpdateEnvironmentParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const environment = await this.service.updateEnvironment(params);
      return {
        content: `Environment updated. New conversations prepare it; ones already running keep what they built.\n${formatEnvironment(environment)}`,
        state: { environment },
        success: true,
      };
    } catch (error) {
      return failure(error);
    }
  }

  async addRunner(params: AddRunnerParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const runner = await this.service.addRunner(params);
      return {
        content: `Added runner ${runner.id} (${runner.path}), last in priority. Use reorderRunners to move it up.`,
        state: { runners: [runner] },
        success: true,
      };
    } catch (error) {
      return failure(error);
    }
  }

  async removeRunner(params: RemoveRunnerParams): Promise<BuiltinServerRuntimeOutput> {
    if (params.runnerId === SANDBOX_RUNNER_ID)
      return failure(new Error('The cloud sandbox cannot be removed; reorder it instead.'));
    try {
      await this.service.removeRunner(params);
      return {
        content: `Removed runner ${params.runnerId}. Files on the device are kept.`,
        success: true,
      };
    } catch (error) {
      return failure(error);
    }
  }

  async reorderRunners(params: ReorderRunnersParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const runners = await this.service.reorderRunners(params);
      return { content: formatRunners(runners), state: { runners }, success: true };
    } catch (error) {
      return failure(error);
    }
  }
}

/** Same repository whatever the trailing `.git`, slash or case. */
export const sameRepository = (a: string, b: string) => {
  const normalize = (url: string) =>
    url
      .trim()
      .replace(/\/+$/, '')
      .replace(/\.git$/, '')
      .toLowerCase();
  return normalize(a) === normalize(b);
};

type Source = { kind: string; ref?: string; url?: string } & Record<string, unknown>;

/**
 * Applies a partial edit to a stored configuration: repositories removed, then
 * added (an already listed one is left as it is), setup and notes set or
 * cleared with "". Everything else, variables included, is kept as stored.
 */
export const applyEnvironmentEdit = <
  T extends { bootstrapCommand?: string; notes?: string; sources?: Source[] },
>(
  configuration: T,
  edit: UpdateEnvironmentParams,
): T => {
  let sources = [...(configuration.sources ?? [])];
  for (const url of edit.removeRepositories ?? [])
    sources = sources.filter((source) => !(source.url && sameRepository(source.url, url)));
  for (const { ref, url } of edit.addRepositories ?? []) {
    if (sources.some((source) => source.url && sameRepository(source.url, url))) continue;
    sources.push({ kind: 'git', url: url.trim(), ...(ref?.trim() && { ref: ref.trim() }) });
  }
  const next: T = { ...configuration, sources };
  if (edit.setupCommand !== undefined) next.bootstrapCommand = edit.setupCommand || undefined;
  if (edit.notes !== undefined) next.notes = edit.notes || undefined;
  return next;
};
