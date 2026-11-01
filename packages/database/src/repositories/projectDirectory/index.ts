import { getWorkingDirSourcePath } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { and, eq, inArray, isNull } from 'drizzle-orm';

import { EnvironmentModel, normalizeProjectRepository } from '../../models/environment';
import { EnvironmentInstanceModel } from '../../models/environmentInstance';
import { ProjectModel } from '../../models/project';
import {
  normalizeProjectDirectory,
  ProjectWorkingDirectoryModel,
} from '../../models/projectWorkingDirectory';
import { hasLiveTaskCallbackReservation } from '../../models/topic';
import { agents, devices, projectEnvironments, topics } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { joinTopicAgentsToProjects } from '../../utils/projectTopicAgents';
import { buildWorkspaceWhere } from '../../utils/workspace';

/**
 * A refused directory write. It carries its tRPC code, so a permission or
 * state problem reaches the client as a 4xx with this message instead of
 * being wrapped as an internal server error.
 */
export class ProjectDirectoryError extends TRPCError {
  constructor(code: 'BAD_REQUEST' | 'CONFLICT' | 'FORBIDDEN' | 'NOT_FOUND', message: string) {
    super({ code, message });
    this.name = 'ProjectDirectoryError';
  }
}

export type SkippedProjectTopicReason =
  'differentLocation' | 'notFound' | 'otherProject' | 'running';

export interface SkippedProjectTopic {
  id: string;
  reason: SkippedProjectTopicReason;
}

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
    if (!project)
      throw new ProjectDirectoryError('NOT_FOUND', 'Project not found or access denied');
    return project;
  }

  async bind(input: BindProjectDirectoryInput) {
    await this.assertManageableProject(input.projectId);
    return this.db.transaction(async (tx) => {
      const db = tx as LobeChatDatabase;
      const environmentModel = new EnvironmentModel(db, this.userId, this.workspaceId);
      const instanceModel = new EnvironmentInstanceModel(db, this.userId, this.workspaceId);
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
      if (!device)
        throw new ProjectDirectoryError('NOT_FOUND', 'Device not found or access denied');
      const path = normalizeProjectDirectory(input.path, device.platform);
      const repositoryUrl = input.repositoryUrl
        ? normalizeProjectRepository(input.repositoryUrl)
        : undefined;
      const existing = await instanceModel.findByDeviceAndDirectory(device.id, path);
      let instance = existing;
      let environment;
      // An environment is the definition; an instance is one materialization of
      // it. So the same project bound on a second device reuses the definition
      // the first binding made and adds its own instance, rather than minting a
      // second environment under the same name — which is both what the
      // (user, scope, name) unique indexes require and what the two concepts
      // already meant.
      const knownId = existing?.environmentId ?? input.environmentId;
      const named = knownId ? undefined : await environmentModel.findByName(input.name);
      const environmentId = knownId ?? named?.id;
      if (environmentId) {
        environment = await environmentModel.findEnabledById(environmentId);
        // The name lookup deliberately sees disabled rows, because the unique
        // indexes do: a disabled environment of this name still owns the name,
        // so minting a replacement would only hit the constraint.
        if (!environment && named)
          throw new ProjectDirectoryError('BAD_REQUEST', 'Environment is disabled');
        if (!environment || (input.environmentId && input.environmentId !== environment.id))
          throw new ProjectDirectoryError(
            'CONFLICT',
            'This directory belongs to another environment',
          );
        if (
          repositoryUrl &&
          !environment.configuration.sources?.some(
            (source) => source.kind === 'git' && source.url === repositoryUrl,
          )
        )
          throw new ProjectDirectoryError(
            'CONFLICT',
            'Repository differs from the existing environment',
          );
      } else {
        environment = await environmentModel.save({
          name: input.name,
          repositoryUrl: input.repositoryUrl,
        });
      }
      if (!instance) {
        instance = await instanceModel.createForDeviceBinding({
          configurationSnapshot: environment.configuration,
          deviceId: device.id,
          environmentId: environment.id,
          name: input.name.trim(),
          workingDirectory: path,
        });
      }
      if (!instance.enabled)
        throw new ProjectDirectoryError('BAD_REQUEST', 'Environment instance is disabled');
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
      if (!link.enabled)
        throw new ProjectDirectoryError('BAD_REQUEST', 'Environment is disabled in this project');
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
      const skippedTopics: SkippedProjectTopic[] = [];
      if (input.topicIds?.length) {
        if (!input.agentId)
          throw new ProjectDirectoryError(
            'BAD_REQUEST',
            'Agent is required when filing conversations',
          );
        const [filingAgent] = await db
          .select()
          .from(agents)
          .where(and(eq(agents.id, input.agentId), buildWorkspaceWhere(this.scope(), agents)));
        if (
          !filingAgent ||
          (filingAgent.agencyConfig?.executionTargetSelectionPolicy === 'fixed' &&
            filingAgent.agencyConfig.boundDeviceId !== device.deviceId)
        )
          throw new ProjectDirectoryError('FORBIDDEN', 'Agent cannot use this execution target');
        const topicIds = [...new Set(input.topicIds)];
        const selected = await db
          .select()
          .from(topics)
          .where(
            // Workspace-scoped, not creator-scoped: a shared agent's directory
            // holds every member's conversations, and `topics.userId` only
            // records who started one. The router already authorized the
            // caller to use them. Share-visitor topics (`senderId`) stay out:
            // they are hidden from members, and filing one into a project
            // would list it there.
            and(
              inArray(topics.id, topicIds),
              eq(topics.agentId, input.agentId),
              buildWorkspaceWhere(this.scope(), topics),
              isNull(topics.deletedAt),
              isNull(topics.senderId),
            ),
          )
          .for('update');
        const found = new Set(selected.map((topic) => topic.id));
        for (const id of topicIds)
          if (!found.has(id)) skippedTopics.push({ id, reason: 'notFound' });
        const filedTopicIds: string[] = [];
        // Filing is a convenience on top of the binding: one conversation that
        // cannot move must not cost the directory or the others, so it is
        // skipped and reported instead of failing the whole bind.
        for (const topic of selected) {
          const metadata = topic.metadata ?? {};
          const source = getWorkingDirSourcePath(
            metadata.workingDirectoryConfig ?? metadata.workingDirectory,
          );
          const pinnedDevice = metadata.boundDeviceId ?? metadata.runningOperation?.deviceId;
          const reason: SkippedProjectTopicReason | undefined =
            !source ||
            normalizeProjectDirectory(source, device.platform) !== path ||
            (pinnedDevice && pinnedDevice !== device.deviceId)
              ? 'differentLocation'
              : topic.projectId && topic.projectId !== input.projectId
                ? 'otherProject'
                : metadata.runningOperation || topic.status === 'running'
                  ? 'running'
                  : undefined;
          if (reason) {
            skippedTopics.push({ id: topic.id, reason });
            continue;
          }
          await db
            .update(topics)
            .set({
              projectId: input.projectId,
              projectWorkingDirectoryId: directory.id,
              metadata: { ...metadata, boundDeviceId: device.deviceId },
            })
            .where(eq(topics.id, topic.id));
          filedTopicIds.push(topic.id);
        }
        await joinTopicAgentsToProjects(db, { topicIds: filedTopicIds });
      }
      return { ...directory, skippedTopics };
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
          // Workspace-scoped, not creator-scoped, without share-visitor
          // topics — see `bind`.
          and(
            eq(topics.id, topicId),
            buildWorkspaceWhere(this.scope(), topics),
            isNull(topics.deletedAt),
            isNull(topics.senderId),
          ),
        )
        .for('update');
      if (!topic) throw new ProjectDirectoryError('NOT_FOUND', 'Topic not found or access denied');
      if (topic.projectId && topic.projectId !== projectId)
        throw new ProjectDirectoryError('CONFLICT', 'Topic already belongs to another project');
      if (topic.status === 'running' || topic.metadata?.runningOperation)
        throw new ProjectDirectoryError(
          'CONFLICT',
          'Wait for the running topic to finish before associating it',
        );
      const source = getWorkingDirSourcePath(
        topic.metadata?.workingDirectoryConfig ?? topic.metadata?.workingDirectory,
      );
      if (source && !directory)
        throw new ProjectDirectoryError('BAD_REQUEST', 'Select the existing working directory');
      const pinned = topic.metadata?.boundDeviceId;
      if (
        directory &&
        ((source && normalizeProjectDirectory(source, directory.platform) !== directory.path) ||
          (pinned && pinned !== directory.deviceId))
      )
        throw new ProjectDirectoryError(
          'BAD_REQUEST',
          'Keep the existing device and working directory',
        );
      if (topic.projectWorkingDirectoryId && topic.projectWorkingDirectoryId !== directoryId)
        throw new ProjectDirectoryError('CONFLICT', 'Keep the existing project directory binding');
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
          throw new ProjectDirectoryError('FORBIDDEN', 'Agent cannot use this execution target');
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
      await joinTopicAgentsToProjects(db, { topicIds: [topicId] });
      return updated;
    });
  }
  /**
   * Move a project-directory conversation to its project's directory on another
   * device. The directory belongs to the project, so switching devices means
   * switching to that project's directory there — never to an arbitrary path.
   * The cwd and CLI session only hold on the old machine, so they go with it.
   */
  async moveTopic(topicId: string, directoryId: string) {
    return this.db.transaction(async (tx) => {
      const db = tx as LobeChatDatabase;
      const [topic] = await db
        .select()
        .from(topics)
        .where(
          // Workspace-scoped, not creator-scoped: `topics.userId` only records
          // who started a shared topic, and any member the router authorized to
          // use it may move it.
          and(
            eq(topics.id, topicId),
            buildWorkspaceWhere(this.scope(), topics),
            isNull(topics.deletedAt),
          ),
        )
        .for('update');
      if (!topic) throw new ProjectDirectoryError('NOT_FOUND', 'Topic not found or access denied');
      if (!topic.projectId || !topic.projectWorkingDirectoryId)
        throw new ProjectDirectoryError('BAD_REQUEST', 'Topic is not bound to a project directory');
      // A start that holds the reservation may already have resolved the old
      // directory; moving under it would run the turn on the old machine while
      // the topic is persisted as bound to the new one. The row lock above
      // serializes with the reservation write.
      if (
        topic.status === 'running' ||
        topic.metadata?.runningOperation ||
        hasLiveTaskCallbackReservation(topic.metadata)
      )
        throw new ProjectDirectoryError(
          'CONFLICT',
          'Wait for the running topic to finish before moving it',
        );
      // Scoped to the topic's own project: another project's directory is not
      // a device switch, it is a different conversation context.
      const directory = await new ProjectWorkingDirectoryModel(
        db,
        this.userId,
        this.workspaceId,
      ).resolve(directoryId, topic.projectId);
      if (directory.id === topic.projectWorkingDirectoryId) return topic;
      if (topic.agentId) {
        const [agent] = await db
          .select()
          .from(agents)
          .where(and(eq(agents.id, topic.agentId), buildWorkspaceWhere(this.scope(), agents)));
        if (
          !agent ||
          (agent.agencyConfig?.executionTargetSelectionPolicy === 'fixed' &&
            agent.agencyConfig.boundDeviceId !== directory.deviceId)
        )
          throw new ProjectDirectoryError('FORBIDDEN', 'Agent cannot use this execution target');
      }
      const {
        heteroSessionBindingKey: _bindingKey,
        heteroSessionBindingKeyByWorkingDirectory: _bindingKeys,
        heteroSessionId: _sessionId,
        heteroSessionIdByWorkingDirectory: _sessionIds,
        ...metadata
      } = topic.metadata ?? {};
      const [updated] = await db
        .update(topics)
        .set({
          metadata: {
            ...metadata,
            boundDeviceId: directory.deviceId,
            workingDirectory: directory.path,
            workingDirectoryConfig: { path: directory.path },
          },
          projectWorkingDirectoryId: directory.id,
        })
        .where(eq(topics.id, topicId))
        .returning();
      return updated;
    });
  }
}
