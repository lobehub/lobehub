import { getWorkingDirSourcePath } from '@lobechat/types';
import { and, eq, inArray, isNull } from 'drizzle-orm';

import { EnvironmentModel, normalizeProjectRepository } from '../../models/environment';
import { ProjectModel } from '../../models/project';
import {
  normalizeProjectDirectory,
  ProjectWorkingDirectoryModel,
} from '../../models/projectWorkingDirectory';
import { agents, devices, projectEnvironments, topics } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { buildWorkspaceWhere } from '../../utils/workspace';

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

/**
 * Cross-aggregate write flows for project working directories. Binding a
 * directory upserts the environment, its device instance, the project link and
 * the directory row — and optionally files existing conversations — as one
 * transaction, so it lives here rather than on any single-aggregate model.
 * Read paths stay on {@link ProjectWorkingDirectoryModel}.
 */
export class ProjectDirectoryRepository {
  constructor(
    private readonly db: LobeChatDatabase,
    private readonly userId: string,
    private readonly workspaceId?: string,
  ) {}

  private scope() {
    return { userId: this.userId, workspaceId: this.workspaceId };
  }

  private async assertManageableProject(projectId: string) {
    const project = await new ProjectModel(
      this.db,
      this.userId,
      this.workspaceId,
    ).findManageableById(projectId);
    if (!project) throw new Error('Project not found or access denied');
    return project;
  }

  async bind(input: BindProjectDirectoryInput) {
    await this.assertManageableProject(input.projectId);
    return this.db.transaction(async (tx) => {
      const db = tx as LobeChatDatabase;
      const environmentModel = new EnvironmentModel(db, this.userId, this.workspaceId);
      const projectModel = new ProjectModel(db, this.userId, this.workspaceId);
      const directoryModel = new ProjectWorkingDirectoryModel(db, this.userId, this.workspaceId);
      // Serialize bindings of the same device, including bindings from different projects.
      const [device] = await db
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
      const existing = await environmentModel.findDeviceInstance(device.id, path);
      let instance = existing;
      let environment;
      const environmentId = existing?.environmentId ?? input.environmentId;
      if (environmentId) {
        environment = await environmentModel.findEnabledById(environmentId);
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
        environment = await environmentModel.save({
          name: input.name,
          repositoryUrl: input.repositoryUrl,
        });
      }
      if (!instance) {
        instance = await environmentModel.createDeviceInstance({
          configurationSnapshot: environment.configuration,
          deviceId: device.id,
          environmentId: environment.id,
          name: input.name.trim(),
          workingDirectory: path,
        });
      }
      if (!instance.enabled) throw new Error('Environment instance is disabled');
      await projectModel.attachEnvironment(input.projectId, environment.id);
      const [link] = await db
        .select()
        .from(projectEnvironments)
        .where(
          and(
            eq(projectEnvironments.projectId, input.projectId),
            eq(projectEnvironments.environmentId, environment.id),
          ),
        );
      if (!link.enabled) throw new Error('Environment is disabled in this project');
      const prior = await directoryModel.findByLocation(input.projectId, device.id, path);
      const directory =
        prior ??
        (await directoryModel.create({
          addedByUserId: this.userId,
          deviceId: device.id,
          name: input.name.trim(),
          path,
          projectId: input.projectId,
          workspaceId: this.workspaceId,
        }));
      if (input.topicIds?.length) {
        if (!input.agentId) throw new Error('Agent is required when filing conversations');
        const selected = await db
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
          const pinnedDevice = metadata.boundDeviceId ?? metadata.runningOperation?.deviceId;
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
          await db
            .update(topics)
            .set({
              projectId: input.projectId,
              projectWorkingDirectoryId: directory.id,
              metadata: { ...metadata, boundDeviceId: device.deviceId },
            })
            .where(eq(topics.id, topic.id));
        }
      }
      return directory;
    });
  }

  async associateTopic(projectId: string, topicId: string, directoryId?: string) {
    await this.assertManageableProject(projectId);
    return this.db.transaction(async (tx) => {
      const db = tx as LobeChatDatabase;
      const directory = directoryId
        ? await new ProjectWorkingDirectoryModel(db, this.userId, this.workspaceId).resolve(
            directoryId,
            projectId,
          )
        : undefined;
      const [topic] = await db
        .select()
        .from(topics)
        .where(
          and(
            eq(topics.id, topicId),
            eq(topics.userId, this.userId),
            buildWorkspaceWhere(this.scope(), topics),
            isNull(topics.deletedAt),
          ),
        )
        .for('update');
      if (!topic) throw new Error('Topic not found or access denied');
      if (topic.projectId && topic.projectId !== projectId)
        throw new Error('Topic already belongs to another project');
      if (topic.status === 'running' || topic.metadata?.runningOperation)
        throw new Error('Wait for the running topic to finish before associating it');
      const source = getWorkingDirSourcePath(
        topic.metadata?.workingDirectoryConfig ?? topic.metadata?.workingDirectory,
      );
      if (source && !directory) throw new Error('Select the existing working directory');
      const pinned = topic.metadata?.boundDeviceId;
      if (
        directory &&
        ((source && source.replace(/[\\/]+$/, '') !== directory.path.replace(/[\\/]+$/, '')) ||
          (pinned && pinned !== directory.deviceId))
      )
        throw new Error('Keep the existing device and working directory');
      if (topic.projectWorkingDirectoryId && topic.projectWorkingDirectoryId !== directoryId)
        throw new Error('Keep the existing project directory binding');
      if (directory && topic.agentId) {
        const [agent] = await db
          .select()
          .from(agents)
          .where(and(eq(agents.id, topic.agentId), buildWorkspaceWhere(this.scope(), agents)));
        if (
          !agent ||
          (agent.agencyConfig?.executionTargetSelectionPolicy === 'fixed' &&
            agent.agencyConfig.boundDeviceId !== directory.deviceId)
        )
          throw new Error('Agent cannot use this execution target');
      }
      const [updated] = await db
        .update(topics)
        .set({
          projectId,
          ...(directory
            ? {
                projectWorkingDirectoryId: directory.id,
                metadata: {
                  ...topic.metadata,
                  boundDeviceId: directory.deviceId,
                  workingDirectory: directory.path,
                  workingDirectoryConfig: { path: directory.path },
                },
              }
            : {}),
        })
        .where(eq(topics.id, topicId))
        .returning();
      return updated;
    });
  }
}
