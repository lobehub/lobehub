import { layoutRepositorySources } from '@lobechat/types';
import { eq, max } from 'drizzle-orm';

import { AgentModel } from '../../models/agent';
import { normalizeProjectRepository } from '../../models/environment';
import type { CreateProjectInput, ProjectModelOptions } from '../../models/project';
import {
  normalizeProjectIdentifier,
  ProjectIdentifierTakenError,
  ProjectModel,
} from '../../models/project';
import { createProjectMainAgent } from '../../models/projectMainAgent';
import { projectAgents, projectCompletionReviews } from '../../schemas/project';
import type { LobeChatDatabase } from '../../type';
import { ProjectEnvironmentRepository } from '../projectEnvironment';

/**
 * Cross-aggregate write flow for projects. Creating a project also creates (or
 * binds) its main agent — an `agents` row that AgentModel owns and that outlives
 * the project — so the transaction spanning both aggregates lives here, while
 * {@link ProjectModel.create} owns only the project row and its coordinator link
 * row.
 */
export class ProjectRepository {
  constructor(
    private readonly db: LobeChatDatabase,
    private readonly userId: string,
    private readonly workspaceId?: string,
    private readonly options: ProjectModelOptions = {},
  ) {}

  private model(db: LobeChatDatabase) {
    return new ProjectModel(db, this.userId, this.workspaceId, this.options);
  }

  async create({
    additionalRepositories,
    dedicatedAgentId,
    repository,
    ...input
  }: CreateProjectInput) {
    const identifier = normalizeProjectIdentifier(input.identifier);

    return this.db.transaction(async (tx) => {
      const db = tx as LobeChatDatabase;
      const projectModel = new ProjectModel(db, this.userId, this.workspaceId);

      // Fail before the main agent is written when the identifier is taken. The
      // model re-checks inside its own transaction and translates the unique
      // violation, which covers the concurrent-create race.
      if (identifier && (await projectModel.isIdentifierTaken(identifier))) {
        throw new ProjectIdentifierTakenError(identifier);
      }

      const mainAgent = input.coordinatorAgentId
        ? await projectModel.findAccessibleAgent(db, input.coordinatorAgentId)
        : await createProjectMainAgent(
            db,
            { userId: this.userId, workspaceId: this.workspaceId },
            {
              avatar: input.avatar,
              id: dedicatedAgentId,
              name: input.name,
              visibility: input.visibility,
            },
          );
      if (!mainAgent) throw new Error('Agent not found');

      if (input.coordinatorAgentId) {
        projectModel.assertSharedResource(
          { visibility: input.visibility ?? 'private', workspaceId: this.workspaceId ?? null },
          (mainAgent as { visibility: string }).visibility,
          'A shared project only takes shared agents',
        );
      }

      const project = await projectModel.create({
        ...input,
        coordinatorAgentId: mainAgent.id,
        identifier,
      });
      await this.linkCoordinator(db, project.id, mainAgent.id);

      // Every project has its own environment, made with it in the same
      // transaction so a repository it cannot accept leaves no half-made
      // project behind. One made from a repository checks it out; any other
      // starts with nothing to check out and is filled in from the project's
      // settings.
      const repositories = [...(repository ? [repository] : []), ...(additionalRepositories ?? [])];
      const seen = new Set<string>();
      const sources = repositories.flatMap((item) => {
        const url = normalizeProjectRepository(item.url);
        if (seen.has(url)) return [];
        seen.add(url);
        const ref = item.defaultBranch?.trim();
        return [{ kind: 'git' as const, url, ...(ref && { ref }) }];
      });
      await ProjectEnvironmentRepository.createForProject(
        db,
        project,
        sources.length > 0 ? { sources: layoutRepositorySources(sources) } : {},
      );

      return project;
    });
  }

  /**
   * Deletes a project and retires a coordinator provisioned for it: a virtual,
   * non-builtin agent no other project still uses. Reusable agents (user agents,
   * LobeAI) stay with their sessions intact.
   */
  async delete(id: string) {
    return this.db.transaction(async (tx) => {
      const db = tx as LobeChatDatabase;
      const projectModel = this.model(db);
      const project = await projectModel.findManageableById(id);
      if (!project) return null;

      // Also releases the project's environment (see `ProjectModel.delete`).
      const deleted = await projectModel.delete(id);
      // Asked after the delete, so this project no longer counts as one still using it.
      const agentId = project.coordinatorAgentId;
      if (agentId && (await projectModel.isDedicatedCoordinator(agentId, { db }))) {
        await new AgentModel(db, this.userId, this.workspaceId).delete(agentId);
      }
      return deleted;
    });
  }

  /**
   * Records the next round of a completion review and settles the project by it,
   * holding the project row so concurrent reviews number their rounds in turn.
   */
  async reviewCompletion(id: string, decision: 'accepted' | 'rejected', comment?: string) {
    return this.db.transaction(async (tx) => {
      const db = tx as LobeChatDatabase;
      const projectModel = this.model(db);
      const project = await projectModel.findManageableById(id, { lock: true });
      if (!project) return null;
      if (project.status !== 'reviewing') throw new Error('Project is not awaiting review');

      const [{ value: lastRound }] = await db
        .select({ value: max(projectCompletionReviews.round) })
        .from(projectCompletionReviews)
        .where(eq(projectCompletionReviews.projectId, id));
      const [review] = await db
        .insert(projectCompletionReviews)
        .values({
          comment,
          decision,
          projectId: id,
          reviewerUserId: this.userId,
          round: (lastRound ?? 0) + 1,
          workspaceId: this.workspaceId ?? null,
        })
        .returning();
      const updated = await projectModel.applyCompletionReview(id, decision, review.id);
      return { project: updated, review };
    });
  }

  /**
   * Seat the main agent on the project it leads. The link lives in the project
   * aggregate but points at a row another aggregate owns, so it is written here
   * alongside the project insert rather than inside the model.
   */
  private async linkCoordinator(db: LobeChatDatabase, projectId: string, agentId: string) {
    await db.insert(projectAgents).values({
      addedByUserId: this.userId,
      agentId,
      projectId,
      responsibility: 'Coordinates project conversations, work, and resources',
      role: 'coordinator',
      workspaceId: this.workspaceId ?? null,
    });
  }
}
