import type { LobeChatDatabase } from '@lobechat/database';
import type { ProjectContextEnvironment, ProjectContextRunner } from '@lobechat/prompts';
import type { EnvironmentConfiguration } from '@lobechat/types';

import { ProjectWorkingDirectoryModel } from '@/database/models/projectWorkingDirectory';
import { ProjectDirectoryRepository } from '@/database/repositories/projectDirectory';
import { ProjectEnvironmentRepository } from '@/database/repositories/projectEnvironment';
import { deviceGateway } from '@/server/services/deviceGateway';

interface RunnerDirectory {
  deviceId?: string | null;
  deviceName?: string | null;
  path: string;
  platform?: string | null;
  runnable?: boolean | null;
  sortOrder?: number | null;
}

/**
 * The project's runners in its priority order, as the settings list and the
 * picker show them: by stored place, a folder before the sandbox on a tie, and
 * folders among themselves in the order they came. Only a folder a run can
 * start in is listed. `onlineDeviceIds` is the set the device gateway reports
 * connected; absent, presence is unknown rather than offline.
 */
export const orderProjectRunners = (
  directories: readonly RunnerDirectory[],
  sandboxOrder: number,
  onlineDeviceIds?: ReadonlySet<string>,
): ProjectContextRunner[] =>
  [
    ...directories
      .filter((directory) => directory.runnable)
      .map((directory, index) => ({
        index,
        runner: {
          kind: 'device',
          name: directory.deviceName || directory.deviceId || 'device',
          online:
            onlineDeviceIds && directory.deviceId
              ? onlineDeviceIds.has(directory.deviceId)
              : undefined,
          path: directory.path,
          platform: directory.platform,
        } as ProjectContextRunner,
        sortOrder: directory.sortOrder ?? 0,
      })),
    {
      index: Number.MAX_SAFE_INTEGER,
      runner: { kind: 'sandbox' } as const,
      sortOrder: sandboxOrder,
    },
  ]
    .sort((a, b) => a.sortOrder - b.sortOrder || a.index - b.index)
    .map(({ runner }) => runner);

/** The environment as the agent is told it: repositories, setup, variable names and notes. */
export const describeProjectEnvironment = (
  configuration: EnvironmentConfiguration | null | undefined,
): ProjectContextEnvironment => ({
  bootstrapCommand: configuration?.bootstrapCommand,
  envNames: Object.keys(configuration?.env ?? {}),
  notes: configuration?.notes,
  repositories: (configuration?.sources ?? []).flatMap((source) =>
    source.kind === 'git'
      ? [
          {
            folder: source.path,
            ref: source.ref,
            setupCommand: source.setupCommand,
            url: source.url,
          },
        ]
      : [],
  ),
});

/**
 * Reads where the project's work can run and what each runner prepares, for
 * the project context. Each part fails on its own: a missing presence read
 * leaves devices as "presence unknown", a missing list leaves the part out.
 */
export const readProjectRunnersContext = async (
  deps: { db: LobeChatDatabase; userId: string; workspaceId?: string },
  projectId: string,
): Promise<{ environment?: ProjectContextEnvironment; runners?: ProjectContextRunner[] }> => {
  const { db, userId, workspaceId } = deps;
  const [directories, order, environment, onlineDevices] = await Promise.all([
    new ProjectWorkingDirectoryModel(db, userId, workspaceId)
      .list(projectId)
      .catch(() => undefined),
    new ProjectDirectoryRepository(db, userId, workspaceId)
      .executionOrder(projectId)
      .catch(() => undefined),
    new ProjectEnvironmentRepository(db, userId, workspaceId).get(projectId).catch(() => undefined),
    deviceGateway.queryDeviceList(userId, workspaceId).catch(() => undefined),
  ]);

  const onlineIds = onlineDevices
    ? new Set(onlineDevices.filter((device) => device.online).map((device) => device.deviceId))
    : undefined;

  return {
    environment: environment ? describeProjectEnvironment(environment.configuration) : undefined,
    runners: directories
      ? orderProjectRunners(directories, order?.sandbox ?? 0, onlineIds)
      : undefined,
  };
};
