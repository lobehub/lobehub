import { INBOX_SESSION_ID } from '@lobechat/const';
import type { ProjectCoordinatorConfigSnapshot, ProjectCoordinatorSource } from '@lobechat/types';
import { and, asc, desc, eq, ne } from 'drizzle-orm';

import { AgentModel } from '../../models/agent';
import { ProjectModel, type ProjectModelOptions } from '../../models/project';
import { updateProjectAgent } from '../../models/project/agents';
import type { AgentItem } from '../../schemas';
import { agents } from '../../schemas/agent';
import { projectAgents, projects } from '../../schemas/project';
import type { LobeChatDatabase } from '../../type';
import {
  classifyProjectCoordinator,
  findCoordinatorAgent,
  snapshotCoordinatorConfig,
} from '../projectCoordinatorOwnership';

/** The coordinator fields a project's settings may write. */
export const PROJECT_COORDINATOR_CONFIG_FIELDS = [
  'avatar',
  'chatConfig',
  'description',
  'model',
  'openingMessage',
  'openingQuestions',
  'params',
  'plugins',
  'provider',
  'systemRole',
  'title',
  'tts',
] as const;

export type ProjectCoordinatorConfigField = (typeof PROJECT_COORDINATOR_CONFIG_FIELDS)[number];

export type ProjectCoordinatorConfigPatch = Partial<Pick<AgentItem, ProjectCoordinatorConfigField>>;

export interface ProjectCoordinatorConfig {
  /** The agent row holding the configuration; LobeAI's id when the project falls back to it. */
  agentId: string;
  config: ProjectCoordinatorConfigSnapshot;
  /** Whether the project settings may write `config` (LobeAI is read-only from a project). */
  editable: boolean;
  /** `agents.owner_project_id` as stored. */
  ownerProjectId: string | null;
  projectId: string;
  /** The coordinator's duty in this project (`project_agents.responsibility`), a project-side field. */
  responsibility: string | null;
  /** Other projects this agent also leads; a write here reaches them too. */
  sharedWithProjectIds: string[];
  source: ProjectCoordinatorSource;
}

export class ProjectCoordinatorConfigError extends Error {
  constructor(
    message: string,
    readonly code: 'BUILTIN_READ_ONLY' | 'NOT_FOUND',
  ) {
    super(message);
    this.name = 'ProjectCoordinatorConfigError';
  }
}

export interface UpdateProjectCoordinatorConfigInput {
  config?: ProjectCoordinatorConfigPatch;
  responsibility?: string | null;
}

/**
 * Reads and writes a project's main agent configuration by project — the single
 * entry the project settings page uses for the coordinator's prompt, model,
 * tools and IM channels (design T-14322 §d / §f.1).
 *
 * The project is the authority: the agent is resolved through the project, first
 * as the agent the project owns (`agents.owner_project_id = project`), else as
 * the agent the project links to (`projects.coordinator_agent_id`), else LobeAI.
 * Its source tells the caller how a write behaves:
 * - `owned` — the project's own agent; writes only affect this project;
 * - `shared` / `user_picked` — a linked agent; writes reach every place it is used;
 * - `builtin` — LobeAI; read-only from a project.
 */
export class ProjectCoordinatorConfigRepository {
  constructor(
    private readonly db: LobeChatDatabase,
    private readonly userId: string,
    private readonly workspaceId?: string,
    private readonly options: ProjectModelOptions = {},
  ) {}

  private projectModel(db = this.db) {
    return new ProjectModel(db, this.userId, this.workspaceId, this.options);
  }

  /** The agent a project owns, else the one it links to (`null` = falls back to LobeAI). */
  private async resolveAgentId(db: LobeChatDatabase, project: typeof projects.$inferSelect) {
    const [owned] = await db
      .select({ id: agents.id })
      .from(agents)
      .where(eq(agents.ownerProjectId, project.id))
      // A project owns at most its current coordinator; prefer it should both hold.
      .orderBy(desc(eq(agents.id, project.coordinatorAgentId ?? '')))
      .limit(1);
    return owned?.id ?? project.coordinatorAgentId;
  }

  private async load(
    db: LobeChatDatabase,
    project: typeof projects.$inferSelect,
  ): Promise<ProjectCoordinatorConfig> {
    const linkedId = await this.resolveAgentId(db, project);
    const { agent, decision } = await classifyProjectCoordinator(db, {
      agentId: linkedId,
      projectId: project.id,
    });

    const coordinator =
      agent ??
      (await (async () => {
        const inbox = await new AgentModel(db, this.userId, this.workspaceId).getBuiltinAgent(
          INBOX_SESSION_ID,
        );
        return inbox ? findCoordinatorAgent(db, inbox.id) : null;
      })());
    if (!coordinator) {
      throw new ProjectCoordinatorConfigError('Project main agent not found', 'NOT_FOUND');
    }

    // `owned` before the backfill marks it is still this project's alone;
    // `ownerProjectId` tells the two apart.
    const source: ProjectCoordinatorSource = decision === 'fallback_null' ? 'builtin' : decision;

    const [binding] = await db
      .select({ responsibility: projectAgents.responsibility })
      .from(projectAgents)
      .where(
        and(eq(projectAgents.projectId, project.id), eq(projectAgents.agentId, coordinator.id)),
      )
      .limit(1);

    const sharedWith =
      source === 'builtin'
        ? []
        : await db
            .select({ id: projects.id })
            .from(projects)
            .where(
              and(eq(projects.coordinatorAgentId, coordinator.id), ne(projects.id, project.id)),
            )
            .orderBy(asc(projects.id));

    return {
      agentId: coordinator.id,
      config: await snapshotCoordinatorConfig(db, coordinator),
      editable: source !== 'builtin',
      ownerProjectId: coordinator.ownerProjectId,
      projectId: project.id,
      responsibility: binding?.responsibility ?? null,
      sharedWithProjectIds: sharedWith.map((row) => row.id),
      source,
    };
  }

  /** The coordinator configuration of a project the caller can read (id, slug or identifier). */
  async getConfig(projectReference: string): Promise<ProjectCoordinatorConfig | null> {
    const project = await this.projectModel().findByReference(projectReference);
    if (!project) return null;
    return this.load(this.db, project);
  }

  /**
   * The coordinator a write to this project's settings would change, for a
   * project the caller manages. Callers that apply their own write guards
   * (the tRPC router's edit permission and share-model checks) resolve first.
   */
  async resolveForWrite(projectId: string): Promise<ProjectCoordinatorConfig | null> {
    const project = await this.projectModel().findMembersManageableById(projectId);
    if (!project) return null;
    return this.load(this.db, project);
  }

  /**
   * Write a project's coordinator configuration through the project: agent
   * fields to the resolved agent row (deep-merged like the agent settings do),
   * the coordinator's responsibility to the project's own binding row. Returns
   * the configuration as read back.
   */
  async updateConfig(
    projectId: string,
    { config, responsibility }: UpdateProjectCoordinatorConfigInput,
    {
      writeAgentConfig,
    }: {
      /** Override the agent write (e.g. the server's AgentService with its share-model guard). */
      writeAgentConfig?: (
        agentId: string,
        patch: ProjectCoordinatorConfigPatch,
      ) => Promise<unknown>;
    } = {},
  ): Promise<ProjectCoordinatorConfig | null> {
    const current = await this.resolveForWrite(projectId);
    if (!current) return null;

    const patch = pickConfigPatch(config);
    if (Object.keys(patch).length > 0) {
      if (!current.editable) {
        throw new ProjectCoordinatorConfigError(
          'LobeAI leads this project and is read-only here; create a dedicated coordinator to configure it',
          'BUILTIN_READ_ONLY',
        );
      }
      if (writeAgentConfig) await writeAgentConfig(current.agentId, patch);
      else
        await new AgentModel(this.db, this.userId, this.workspaceId).updateConfig(
          current.agentId,
          patch,
        );
    }

    if (responsibility !== undefined) {
      await updateProjectAgent(this.db, current.projectId, current.agentId, { responsibility });
    }

    return this.resolveForWrite(current.projectId);
  }
}

const pickConfigPatch = (config: ProjectCoordinatorConfigPatch | undefined) => {
  const patch: ProjectCoordinatorConfigPatch = {};
  if (!config) return patch;
  for (const field of PROJECT_COORDINATOR_CONFIG_FIELDS) {
    if (config[field] !== undefined) (patch as Record<string, unknown>)[field] = config[field];
  }
  return patch;
};
