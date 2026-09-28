import nodePath from 'node:path';

import type { EnvironmentConfiguration } from '@lobechat/types';
import { getWorkingDirSourcePath } from '@lobechat/types';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';

import {
  agents,
  devices,
  environmentInstances,
  environments,
  projectEnvironments,
  projects,
  projectWorkingDirectories,
  topics,
} from '../schemas';
import type { LobeChatDatabase } from '../type';
import { buildWorkspaceWhere } from '../utils/workspace';

export const normalizeProjectDirectory = (value: string, platform: string | null) => {
  const paths = platform === 'win32' ? nodePath.win32 : nodePath.posix;
  if (!value.trim() || value.includes('\0') || !paths.isAbsolute(value))
    throw new Error('An absolute directory path is required');
  const normalized = paths.normalize(value);
  return normalized.length > paths.parse(normalized).root.length
    ? normalized.replace(/[\\/]+$/, '')
    : normalized;
};

/**
 * Single-aggregate access to project working directories: directory queries,
 * the environment/instance state resolution behind them, and directory-scoped
 * topic reads. Cross-table write flows (bind, associateTopic) live in
 * `repositories/projectDirectory`; environment and project-link access live on
 * `EnvironmentModel` and `ProjectModel`.
 */
export class ProjectWorkingDirectoryModel {
  constructor(
    private readonly db: LobeChatDatabase,
    private readonly userId: string,
    private readonly workspaceId?: string,
  ) {}

  private scope() {
    return { userId: this.userId, workspaceId: this.workspaceId };
  }

  private async project(id: string, write = false) {
    const [row] = await this.db
      .select()
      .from(projects)
      .where(
        and(
          eq(projects.id, id),
          buildWorkspaceWhere(this.scope(), projects),
          isNull(projects.deletedAt),
          write ? eq(projects.userId, this.userId) : undefined,
        ),
      );
    if (!row) throw new Error('Project not found or access denied');
    return row;
  }

  async findByLocation(projectId: string, deviceId: string, path: string) {
    const [row] = await this.db
      .select()
      .from(projectWorkingDirectories)
      .where(
        and(
          eq(projectWorkingDirectories.projectId, projectId),
          eq(projectWorkingDirectories.deviceId, deviceId),
          eq(projectWorkingDirectories.path, path),
        ),
      );
    return row;
  }

  async create(input: {
    addedByUserId: string;
    deviceId: string;
    name: string;
    path: string;
    projectId: string;
    workspaceId?: string;
  }) {
    const [row] = await this.db.insert(projectWorkingDirectories).values(input).returning();
    return row;
  }

  async list(projectId?: string) {
    if (projectId) await this.project(projectId);
    return this.db
      .select({
        id: projectWorkingDirectories.id,
        name: projectWorkingDirectories.name,
        projectId: projects.id,
        projectName: projects.name,
        projectAvatar: projects.avatar,
        projectSlug: projects.slug,
        // The instance join keys on the global natural key (device, path), so a
        // row can meet an instance another project linked first. Project the
        // instance and its configuration snapshot only when the environment is
        // linked to THIS project — otherwise the row stays a legacy directory
        // with null environment fields, discoverable for upgrade.
        instanceId: sql<
          string | null
        >`case when ${environments.id} is not null then ${environmentInstances.id} else null end`,
        environmentId: environments.id,
        environmentName: environments.name,
        // The materialized instance's snapshot, not the live environment
        // definition — the snapshot is never implicitly refreshed, so it is
        // the configuration the instance actually represents.
        configuration: sql<EnvironmentConfiguration | null>`case when ${environments.id} is not null then ${environmentInstances.configurationSnapshot} else null end`,
        deviceId: devices.deviceId,
        deviceName: devices.friendlyName,
        platform: devices.platform,
        path: sql<string>`coalesce(${environmentInstances.workingDirectory}, ${projectWorkingDirectories.path})`,
        permission: projectWorkingDirectories.permission,
      })
      .from(projectWorkingDirectories)
      .innerJoin(projects, eq(projects.id, projectWorkingDirectories.projectId))
      .leftJoin(
        environmentInstances,
        and(
          eq(environmentInstances.deviceId, projectWorkingDirectories.deviceId),
          eq(environmentInstances.workingDirectory, projectWorkingDirectories.path),
        ),
      )
      .leftJoin(
        projectEnvironments,
        and(
          eq(projectEnvironments.environmentId, environmentInstances.environmentId),
          eq(projectEnvironments.projectId, projects.id),
        ),
      )
      .leftJoin(
        environments,
        and(
          eq(environments.id, projectEnvironments.environmentId),
          buildWorkspaceWhere(this.scope(), environments),
        ),
      )
      .innerJoin(devices, eq(devices.id, projectWorkingDirectories.deviceId))
      .where(
        and(
          buildWorkspaceWhere(this.scope(), projects),
          isNull(projects.deletedAt),
          buildWorkspaceWhere(this.scope(), devices),
          projectId ? eq(projects.id, projectId) : undefined,
        ),
      )
      .orderBy(asc(projectWorkingDirectories.sortOrder), asc(projectWorkingDirectories.createdAt));
  }

  async resolve(id: string, projectId?: string) {
    const row = (await this.list(projectId)).find((item) => item.id === id);
    if (!row) throw new Error('Project directory not found or access denied');
    if (!row.instanceId || !row.environmentId)
      throw new Error('Link this directory to an environment before starting work');
    const [state] = await this.db
      .select({
        instanceEnabled: environmentInstances.enabled,
        environmentEnabled: environments.enabled,
        linked: projectEnvironments.enabled,
      })
      .from(environmentInstances)
      .innerJoin(environments, eq(environments.id, environmentInstances.environmentId))
      .innerJoin(
        projectEnvironments,
        and(
          eq(projectEnvironments.environmentId, environments.id),
          eq(projectEnvironments.projectId, row.projectId),
        ),
      )
      .where(eq(environmentInstances.id, row.instanceId));
    if (!state?.instanceEnabled || !state.environmentEnabled || !state.linked)
      throw new Error('Project environment is disabled');
    if (row.permission !== 'readWrite') throw new Error('This directory is read-only');
    return { ...row, instanceId: row.instanceId, environmentId: row.environmentId };
  }

  async listTopics(directoryId: string) {
    if (!(await this.list()).some((row) => row.id === directoryId))
      throw new Error('Project directory not found or access denied');
    return this.db
      .select({
        id: topics.id,
        title: topics.title,
        agentId: topics.agentId,
        agentTitle: agents.title,
        agentName: agents.name,
        agentAvatar: agents.avatar,
        updatedAt: topics.updatedAt,
      })
      .from(topics)
      .leftJoin(
        agents,
        and(eq(agents.id, topics.agentId), buildWorkspaceWhere(this.scope(), agents)),
      )
      .where(
        and(
          eq(topics.projectWorkingDirectoryId, directoryId),
          buildWorkspaceWhere(this.scope(), topics),
          isNull(topics.deletedAt),
        ),
      )
      .orderBy(asc(topics.updatedAt));
  }

  async resolveForTopic(topicId: string) {
    const [topic] = await this.db
      .select()
      .from(topics)
      .where(and(eq(topics.id, topicId), buildWorkspaceWhere(this.scope(), topics)));
    if (!topic?.projectWorkingDirectoryId) {
      // The binding row is gone (directory deletion sets the FK null) but the
      // topic still carries its project pin. Plain device-bound topics have no
      // projectId and simply follow the normal device-resolution path.
      if (topic?.projectId && topic?.metadata?.boundDeviceId)
        throw new Error('Project directory binding no longer exists');
      return;
    }
    if (!topic.projectId) throw new Error('Project directory has no owning project');
    const directory = await this.resolve(topic.projectWorkingDirectoryId, topic.projectId);
    const source = getWorkingDirSourcePath(
      topic.metadata?.workingDirectoryConfig ?? topic.metadata?.workingDirectory,
    );
    // Compare with the same platform-aware normalization used when binding —
    // legacy metadata may carry non-canonical segments (`./`, `..`, duplicate
    // separators) that a plain trailing-separator trim would reject forever.
    if (source && normalizeProjectDirectory(source, directory.platform) !== directory.path)
      throw new Error('Conversation directory differs from its project binding');
    return directory;
  }
}
