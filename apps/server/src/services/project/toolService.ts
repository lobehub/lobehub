import {
  type ProjectToolEnvironment,
  type ProjectToolRunner,
  type ProjectToolService,
  SANDBOX_RUNNER_ID,
} from '@lobechat/builtin-tool-project';
import { applyEnvironmentEdit } from '@lobechat/builtin-tool-project/executionRuntime';
import { RBAC_PERMISSIONS } from '@lobechat/const/rbac';
import type { LobeChatDatabase } from '@lobechat/database';

import { ProjectWorkingDirectoryModel } from '@/database/models/projectWorkingDirectory';
import { RbacModel } from '@/database/models/rbac';
import { TopicModel } from '@/database/models/topic';
import { ProjectDirectoryRepository } from '@/database/repositories/projectDirectory';
import { ProjectEnvironmentRepository } from '@/database/repositories/projectEnvironment';
import { configurationSchema } from '@/server/routers/lambda/_schema/environment';
import { describeProjectEnvironment } from '@/server/services/aiAgent/pipeline/projectRunners';
import { deviceGateway } from '@/server/services/deviceGateway';
import { getScopedOnlineDevices } from '@/server/services/deviceGateway/scopedDevices';

interface ProjectToolScope {
  projectId: string;
  topicId?: string;
  userId: string;
  workspaceId?: string;
}

const describeEnvironment = (
  configuration: Parameters<typeof describeProjectEnvironment>[0],
): ProjectToolEnvironment => {
  const environment = describeProjectEnvironment(configuration);
  return { ...environment, envNames: environment.envNames ?? [] };
};

type DirectoryRow = Awaited<ReturnType<ProjectWorkingDirectoryModel['list']>>[number];

/**
 * The project tool's data access: the same models, repositories and device
 * checks the project settings use, scoped to the run's project. Writes go
 * through the repositories' own manage-permission checks.
 */
export const createProjectToolService = (
  db: LobeChatDatabase,
  { projectId, topicId, userId, workspaceId }: ProjectToolScope,
): ProjectToolService => {
  const directoryModel = new ProjectWorkingDirectoryModel(db, userId, workspaceId);
  const directoryRepo = new ProjectDirectoryRepository(db, userId, workspaceId);
  const environmentRepo = new ProjectEnvironmentRepository(db, userId, workspaceId);

  /**
   * The settings mutations sit behind `withScopedPermission('agent:update')`,
   * and the repositories' manage check relies on that gate (a readable public
   * project counts as manageable). A tool call reaches the repositories
   * without the router, so it checks the same permission itself: a workspace
   * viewer who may chat and approve a call still cannot change the project.
   */
  const assertCanChange = async () => {
    if (!workspaceId) return;
    const allowed = await new RbacModel(db, userId).hasAnyPermission(
      [RBAC_PERMISSIONS.AGENT_UPDATE_ALL, RBAC_PERMISSIONS.AGENT_UPDATE_OWNER],
      { workspaceId },
    );
    if (!allowed) throw new Error('You do not have permission to change this project');
  };

  const readRunners = async (): Promise<ProjectToolRunner[]> => {
    const [directories, order, presence, topic] = await Promise.all([
      directoryModel.list(projectId),
      directoryRepo.executionOrder(projectId),
      deviceGateway.queryDeviceList(userId, workspaceId).catch(() => undefined),
      topicId ? new TopicModel(db, userId, workspaceId).findById(topicId) : undefined,
    ]);
    const online = presence
      ? new Set(presence.filter((device) => device.online).map((device) => device.deviceId))
      : undefined;
    // A project conversation without a folder runs in the cloud sandbox.
    const currentId =
      topic?.projectId === projectId
        ? (topic.projectWorkingDirectoryId ?? SANDBOX_RUNNER_ID)
        : undefined;
    const pendingId =
      topic?.projectId === projectId ? topic.metadata?.pendingProjectWorkingDirectoryId : undefined;
    const toRunner = (directory: DirectoryRow): ProjectToolRunner => ({
      current: currentId === directory.id || undefined,
      pending: pendingId === directory.id || undefined,
      deviceId: directory.deviceId,
      deviceName: directory.deviceName,
      id: directory.id,
      kind: 'device',
      online: online && directory.deviceId ? online.has(directory.deviceId) : undefined,
      path: directory.path,
      platform: directory.platform,
      runnable: !!directory.runnable,
    });
    // Same order as the settings list: by stored place, a folder before the
    // sandbox on a tie, folders among themselves as listed.
    return [
      ...directories.map((directory, index) => ({
        index,
        runner: toRunner(directory),
        sortOrder: directory.sortOrder ?? 0,
      })),
      {
        index: Number.MAX_SAFE_INTEGER,
        runner: {
          current: currentId === SANDBOX_RUNNER_ID || undefined,
          id: SANDBOX_RUNNER_ID,
          kind: 'sandbox',
        } as ProjectToolRunner,
        sortOrder: order.sandbox,
      },
    ]
      .sort((a, b) => a.sortOrder - b.sortOrder || a.index - b.index)
      .map(({ runner }) => runner);
  };

  return {
    addRunner: async ({ deviceId, path }) => {
      await assertCanChange();
      // Same gate as the settings dialog: a definite "not there" is refused;
      // an unreachable device cannot be checked and stays addable.
      const stat = await deviceGateway.statPath({ deviceId, path, userId, workspaceId });
      if (stat && (!stat.exists || !stat.isDirectory))
        throw new Error(`${path} does not exist on this device or is not a folder`);
      const bound = await directoryRepo.bind({
        deviceId,
        name: path.split(/[\\/]/).findLast(Boolean) || path,
        path,
        projectId,
      });
      return (
        (await readRunners()).find((runner) => runner.id === bound.id) ?? {
          deviceId,
          id: bound.id,
          kind: 'device',
          path,
        }
      );
    },

    getEnvironment: async () =>
      describeEnvironment((await environmentRepo.get(projectId)).configuration),

    listRunners: async () => {
      const [runners, devices] = await Promise.all([
        readRunners(),
        getScopedOnlineDevices(db, userId, workspaceId).catch(() => []),
      ]);
      return {
        devices: devices.map((device) => ({
          deviceId: device.deviceId,
          name: device.friendlyName || device.hostname || device.deviceId,
          online: device.online,
          platform: device.platform,
        })),
        runners,
      };
    },

    removeRunner: async ({ runnerId }) => {
      await assertCanChange();
      await directoryRepo.remove(projectId, runnerId);
    },

    reorderRunners: async ({ runnerIds }) => {
      await assertCanChange();
      await directoryRepo.reorderExecutionEnvironments(projectId, runnerIds);
      return readRunners();
    },

    switchRunner: async ({ runnerId }) => {
      if (!topicId) throw new Error('switchRunner works only inside a conversation');
      // Same permission as moving a conversation from its header.
      if (workspaceId) {
        const allowed = await new RbacModel(db, userId).hasAnyPermission(
          [RBAC_PERMISSIONS.TOPIC_UPDATE_ALL, RBAC_PERMISSIONS.TOPIC_UPDATE_OWNER],
          { workspaceId },
        );
        if (!allowed) throw new Error('You do not have permission to move this conversation');
      }
      const directory = await directoryModel.resolve(runnerId, projectId);
      // Same reachability gate as moving from the header: the next turn drops
      // the session on the current device, so a folder the target device
      // cannot see is refused now, while the current binding still holds.
      const stat = await deviceGateway.statPath({
        deviceId: directory.deviceId,
        path: directory.path,
        userId,
        workspaceId,
      });
      if (!stat?.exists || !stat.isDirectory)
        throw new Error('That device is offline or the folder is not available on it');
      await directoryRepo.requestTopicMove(topicId, directory.id);
      return readRunners();
    },

    updateEnvironment: async (edit) => {
      await assertCanChange();
      const { configuration } = await environmentRepo.get(projectId);
      const edited = applyEnvironmentEdit(configuration ?? {}, edit);
      // Validated as the settings form's edit is: only https github.com repositories.
      const parsed = configurationSchema.safeParse(edited);
      if (!parsed.success)
        throw new Error(
          `Invalid environment: ${parsed.error.issues.map((issue) => issue.message).join('; ')}`,
        );
      // The schema only knows the fields this API edits and strips the rest
      // (`requirements`), so a partial edit keeps whatever it did not touch.
      const updated = await environmentRepo.update(projectId, {
        configuration: { ...edited, ...parsed.data },
      });
      return describeEnvironment(updated.configuration);
    },
  };
};
