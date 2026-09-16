import nodePath from 'node:path';

import type { ChatTopicMetadata, EnvironmentConfiguration } from '@lobechat/types';
import { getWorkingDirSourcePath } from '@lobechat/types';
import { and, asc, eq, inArray, isNull, or, sql } from 'drizzle-orm';

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

export interface BindProjectDirectoryInput {
  agentId?: string;
  deviceId: string;
  environmentId?: string;
  name: string;
  path: string;
  projectId: string;
  repositoryUrl?: string;
  topicIds?: string[];
}

/** Canonical GitHub source only; credentials and arbitrary clone transports are never persisted. */
export const normalizeProjectRepository = (value: string): string => {
  const ssh = /^git@github\.com:([^/]+\/[^/]+?)(?:\.git)?$/.exec(value.trim());
  const url = new URL(ssh ? `https://github.com/${ssh[1]}` : value.trim());
  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'github.com' ||
    url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error('Use a GitHub repository URL without credentials');
  const path = url.pathname.replace(/\/$/, '').replace(/\.git$/, '');
  if (!/^\/[\w.-]+\/[\w.-]+$/.test(path)) throw new Error('Use a GitHub repository URL');
  return `https://github.com${path}`;
};

export const normalizeProjectDirectory = (value: string, platform: string | null) => {
  const paths = platform === 'win32' ? nodePath.win32 : nodePath.posix;
  if (!value.trim() || value.includes('\0') || !paths.isAbsolute(value))
    throw new Error('An absolute directory path is required');
  const normalized = paths.normalize(value);
  return normalized.length > paths.parse(normalized).root.length
    ? normalized.replace(/[\\/]+$/, '')
    : normalized;
};

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

  async listEnvironments(projectId?: string) {
    if (projectId) await this.project(projectId);
    const rows = await this.db
      .select({
        id: environments.id,
        name: environments.name,
        configuration: environments.configuration,
      })
      .from(environments)
      .where(and(buildWorkspaceWhere(this.scope(), environments), eq(environments.enabled, true)));
    if (!projectId) return rows;
    const links = await this.db
      .select({ id: projectEnvironments.environmentId })
      .from(projectEnvironments)
      .where(
        and(eq(projectEnvironments.projectId, projectId), eq(projectEnvironments.enabled, true)),
      );
    return rows.filter((row) => links.some((link) => link.id === row.id));
  }

  async saveEnvironment(input: { id?: string; name: string; repositoryUrl?: string }) {
    const source = input.repositoryUrl?.trim();
    const configuration: EnvironmentConfiguration = source
      ? { sources: [{ kind: 'git', url: normalizeProjectRepository(source) }] }
      : {};
    if (input.id) {
      const [existing] = await this.db
        .select()
        .from(environments)
        .where(
          and(
            eq(environments.id, input.id),
            buildWorkspaceWhere(this.scope(), environments),
            eq(environments.userId, this.userId),
          ),
        );
      if (!existing) throw new Error('Environment not found or access denied');
      const [row] = await this.db
        .update(environments)
        .set({
          name: input.name.trim(),
          configuration: { ...existing.configuration, sources: configuration.sources ?? [] },
          updatedAt: new Date(),
        })
        .where(eq(environments.id, existing.id))
        .returning();
      return row;
    }
    const [row] = await this.db
      .insert(environments)
      .values({
        name: input.name.trim(),
        configuration,
        userId: this.userId,
        workspaceId: this.workspaceId,
      })
      .returning();
    return row;
  }

  async attachEnvironment(projectId: string, environmentId: string) {
    await this.project(projectId, true);
    if (!(await this.listEnvironments()).some((row) => row.id === environmentId))
      throw new Error('Environment not found or access denied');
    await this.db
      .insert(projectEnvironments)
      .values({
        projectId,
        environmentId,
        workspaceId: this.workspaceId,
        addedByUserId: this.userId,
      })
      .onConflictDoNothing();
    return { projectId, environmentId };
  }

  async bind(input: BindProjectDirectoryInput) {
    await this.project(input.projectId, true);
    return this.db.transaction(async (tx) => {
      // Serialize bindings of the same device, including bindings from different projects.
      const [device] = await tx
        .select()
        .from(devices)
        .where(
          and(eq(devices.deviceId, input.deviceId), buildWorkspaceWhere(this.scope(), devices)),
        )
        .for('update');
      if (!device) throw new Error('Device not found or access denied');
      const path = normalizeProjectDirectory(input.path, device.platform);
      const repositoryUrl = input.repositoryUrl
        ? normalizeProjectRepository(input.repositoryUrl)
        : undefined;
      const [existing] = await tx
        .select()
        .from(environmentInstances)
        .where(
          and(
            eq(environmentInstances.deviceId, device.id),
            eq(environmentInstances.workingDirectory, path),
          ),
        );
      let instance = existing;
      let environment;
      const environmentId = existing?.environmentId ?? input.environmentId;
      if (environmentId) {
        [environment] = await tx
          .select()
          .from(environments)
          .where(
            and(
              eq(environments.id, environmentId),
              buildWorkspaceWhere(this.scope(), environments),
              eq(environments.enabled, true),
            ),
          );
        if (!environment || (input.environmentId && input.environmentId !== environment.id))
          throw new Error('This directory belongs to another environment');
        if (
          repositoryUrl &&
          !environment.configuration.sources?.some(
            (source) => source.kind === 'git' && source.url === repositoryUrl,
          )
        )
          throw new Error('Repository differs from the existing environment');
      } else {
        const configuration: EnvironmentConfiguration = repositoryUrl
          ? { sources: [{ kind: 'git', url: repositoryUrl }] }
          : {};
        [environment] = await tx
          .insert(environments)
          .values({
            configuration,
            name: input.name.trim(),
            userId: this.userId,
            workspaceId: this.workspaceId,
          })
          .returning();
      }
      if (!instance) {
        [instance] = await tx
          .insert(environmentInstances)
          .values({
            configurationSnapshot: environment.configuration,
            deviceId: device.id,
            environmentId: environment.id,
            kind: 'device',
            name: input.name.trim(),
            workingDirectory: path,
          })
          .returning();
      }
      if (!instance.enabled) throw new Error('Environment instance is disabled');
      await tx
        .insert(projectEnvironments)
        .values({
          addedByUserId: this.userId,
          environmentId: environment.id,
          projectId: input.projectId,
          workspaceId: this.workspaceId,
        })
        .onConflictDoNothing();
      const [link] = await tx
        .select()
        .from(projectEnvironments)
        .where(
          and(
            eq(projectEnvironments.projectId, input.projectId),
            eq(projectEnvironments.environmentId, environment.id),
          ),
        );
      if (!link.enabled) throw new Error('Environment is disabled in this project');
      const [prior] = await tx
        .select()
        .from(projectWorkingDirectories)
        .where(
          and(
            eq(projectWorkingDirectories.projectId, input.projectId),
            eq(projectWorkingDirectories.deviceId, device.id),
            eq(projectWorkingDirectories.path, path),
          ),
        );
      const [directory] = prior
        ? await tx
            .update(projectWorkingDirectories)
            .set({ environmentInstanceId: instance.id })
            .where(eq(projectWorkingDirectories.id, prior.id))
            .returning()
        : await tx
            .insert(projectWorkingDirectories)
            .values({
              addedByUserId: this.userId,
              deviceId: device.id,
              environmentInstanceId: instance.id,
              name: input.name.trim(),
              path,
              projectId: input.projectId,
              workspaceId: this.workspaceId,
            })
            .returning();
      if (input.topicIds?.length) {
        if (!input.agentId) throw new Error('Agent is required when filing conversations');
        const selected = await tx
          .select()
          .from(topics)
          .where(
            and(
              inArray(topics.id, input.topicIds),
              eq(topics.agentId, input.agentId),
              eq(topics.userId, this.userId),
              buildWorkspaceWhere(this.scope(), topics),
            ),
          )
          .for('update');
        if (selected.length !== new Set(input.topicIds).size)
          throw new Error('Conversation not found or access denied');
        for (const topic of selected) {
          const metadata = topic.metadata ?? {};
          const source = getWorkingDirSourcePath(
            metadata.workingDirectoryConfig ?? metadata.workingDirectory,
          );
          const pinnedDevice =
            metadata.projectExecution?.deviceId ??
            metadata.boundDeviceId ??
            metadata.runningOperation?.deviceId;
          if (
            !source ||
            normalizeProjectDirectory(source, device.platform) !== path ||
            (pinnedDevice && pinnedDevice !== device.deviceId)
          )
            throw new Error('Conversation uses a different directory or device');
          if (topic.projectId && topic.projectId !== input.projectId)
            throw new Error('Conversation already belongs to another project');
          if (metadata.runningOperation || topic.status === 'running')
            throw new Error('Wait for the conversation to finish before binding it');
          await tx
            .update(topics)
            .set({
              projectId: input.projectId,
              projectWorkingDirectoryId: directory.id,
              metadata: { ...metadata, projectExecution: { deviceId: device.deviceId } },
            })
            .where(eq(topics.id, topic.id));
        }
      }
      return directory;
    });
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
        instanceId: environmentInstances.id,
        environmentId: environments.id,
        environmentName: environments.name,
        configuration: environments.configuration,
        deviceId: devices.deviceId,
        deviceName: devices.friendlyName,
        path: sql<string>`coalesce(${environmentInstances.workingDirectory}, ${projectWorkingDirectories.path})`,
        permission: projectWorkingDirectories.permission,
      })
      .from(projectWorkingDirectories)
      .innerJoin(projects, eq(projects.id, projectWorkingDirectories.projectId))
      .leftJoin(
        environmentInstances,
        eq(environmentInstances.id, projectWorkingDirectories.environmentInstanceId),
      )
      .leftJoin(environments, eq(environments.id, environmentInstances.environmentId))
      .leftJoin(
        projectEnvironments,
        and(
          eq(projectEnvironments.projectId, projects.id),
          eq(projectEnvironments.environmentId, environments.id),
        ),
      )
      .innerJoin(
        devices,
        eq(
          devices.id,
          sql`coalesce(${environmentInstances.deviceId}, ${projectWorkingDirectories.deviceId})`,
        ),
      )
      .where(
        and(
          buildWorkspaceWhere(this.scope(), projects),
          isNull(projects.deletedAt),
          or(
            isNull(projectWorkingDirectories.environmentInstanceId),
            and(
              buildWorkspaceWhere(this.scope(), environments),
              eq(projectEnvironments.projectId, projects.id),
            ),
          ),
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

  async startTopic(directoryId: string, agentId: string, title: string) {
    const directory = await this.resolve(directoryId);
    const [agent] = await this.db
      .select()
      .from(agents)
      .where(and(eq(agents.id, agentId), buildWorkspaceWhere(this.scope(), agents)));
    if (!agent) throw new Error('Agent not found or access denied');
    if (
      agent.agencyConfig?.executionTargetSelectionPolicy === 'fixed' &&
      agent.agencyConfig.boundDeviceId !== directory.deviceId
    )
      throw new Error('This agent is fixed to another execution target');
    const metadata: ChatTopicMetadata = {
      projectExecution: { deviceId: directory.deviceId },
      workingDirectory: directory.path,
      workingDirectoryConfig: { path: directory.path },
    };
    const [topic] = await this.db
      .insert(topics)
      .values({
        agentId,
        metadata,
        projectId: directory.projectId,
        projectWorkingDirectoryId: directory.id,
        title,
        userId: this.userId,
        workspaceId: this.workspaceId,
      })
      .returning();
    return topic;
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
      .innerJoin(agents, eq(agents.id, topics.agentId))
      .where(
        and(
          eq(topics.projectWorkingDirectoryId, directoryId),
          buildWorkspaceWhere(this.scope(), topics),
          buildWorkspaceWhere(this.scope(), agents),
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
      if (topic?.metadata?.projectExecution)
        throw new Error('Project directory binding no longer exists');
      return;
    }
    if (!topic.projectId) throw new Error('Project directory has no owning project');
    const directory = await this.resolve(topic.projectWorkingDirectoryId, topic.projectId);
    const source = getWorkingDirSourcePath(
      topic.metadata?.workingDirectoryConfig ?? topic.metadata?.workingDirectory,
    );
    if (source?.replace(/[\\/]+$/, '') !== directory.path.replace(/[\\/]+$/, ''))
      throw new Error('Conversation directory differs from its project binding');
    return directory;
  }
}
