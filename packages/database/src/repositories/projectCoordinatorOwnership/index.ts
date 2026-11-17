import { BUILTIN_AGENT_SLUGS } from '@lobechat/builtin-agents';
import type {
  ProjectCoordinatorConfigSnapshot,
  ProjectCoordinatorOwnershipDecision,
} from '@lobechat/types';
import { and, asc, eq, gt, isNull, ne, notExists, sql } from 'drizzle-orm';

import { PROJECT_AGENT_LABEL } from '../../models/projectMainAgent';
import { agents } from '../../schemas/agent';
import { agentBotProviders } from '../../schemas/agentBotProvider';
import { agentLabelAssignments, agentLabels } from '../../schemas/agentLabel';
import { chatGroupsAgents } from '../../schemas/chatGroup';
import { projectAgents, projectCoordinatorOwnershipLog, projects } from '../../schemas/project';
import type { LobeChatDatabase } from '../../type';

const BUILTIN_SLUGS: ReadonlySet<string> = new Set<string>(Object.values(BUILTIN_AGENT_SLUGS));

type CoordinatorAgentRow = Pick<
  typeof agents.$inferSelect,
  | 'agencyConfig'
  | 'avatar'
  | 'chatConfig'
  | 'description'
  | 'id'
  | 'model'
  | 'openingMessage'
  | 'openingQuestions'
  | 'ownerProjectId'
  | 'params'
  | 'plugins'
  | 'provider'
  | 'slug'
  | 'systemRole'
  | 'title'
  | 'tts'
  | 'virtual'
>;

const coordinatorAgentColumns = {
  agencyConfig: agents.agencyConfig,
  avatar: agents.avatar,
  chatConfig: agents.chatConfig,
  description: agents.description,
  id: agents.id,
  model: agents.model,
  openingMessage: agents.openingMessage,
  openingQuestions: agents.openingQuestions,
  ownerProjectId: agents.ownerProjectId,
  params: agents.params,
  plugins: agents.plugins,
  provider: agents.provider,
  slug: agents.slug,
  systemRole: agents.systemRole,
  title: agents.title,
  tts: agents.tts,
  virtual: agents.virtual,
};

export const findCoordinatorAgent = async (
  db: LobeChatDatabase,
  agentId: string,
): Promise<CoordinatorAgentRow | null> => {
  const [agent] = await db
    .select(coordinatorAgentColumns)
    .from(agents)
    .where(eq(agents.id, agentId))
    .limit(1);
  return agent ?? null;
};

/**
 * The coordinator configuration a project carries, read verbatim from the agent
 * row and its bot connections. Credentials never leave `agent_bot_providers`.
 */
export const snapshotCoordinatorConfig = async (
  db: LobeChatDatabase,
  agent: CoordinatorAgentRow,
): Promise<ProjectCoordinatorConfigSnapshot> => {
  const botProviders = await db
    .select({
      applicationId: agentBotProviders.applicationId,
      enabled: agentBotProviders.enabled,
      platform: agentBotProviders.platform,
      settings: agentBotProviders.settings,
    })
    .from(agentBotProviders)
    .where(eq(agentBotProviders.agentId, agent.id))
    .orderBy(asc(agentBotProviders.platform), asc(agentBotProviders.applicationId));

  return {
    agencyConfig: agent.agencyConfig ?? null,
    avatar: agent.avatar,
    botProviders: botProviders.map((provider) => ({
      ...provider,
      settings: provider.settings ?? null,
    })),
    chatConfig: agent.chatConfig ?? null,
    description: agent.description,
    model: agent.model,
    openingMessage: agent.openingMessage,
    openingQuestions: agent.openingQuestions,
    params: agent.params ?? null,
    plugins: agent.plugins,
    provider: agent.provider,
    systemRole: agent.systemRole,
    title: agent.title,
    tts: agent.tts ?? null,
    virtual: agent.virtual,
  };
};

/**
 * Whether a project created this agent for itself rather than linking one the
 * user already had:
 * - G1: it wears the shared `Project` label `createProjectMainAgent` assigns
 *   (projects created since 2026-11-02);
 * - G2: a virtual, non-builtin agent no group holds — the dedicated coordinator
 *   earlier projects got (same test as `ProjectModel.isDedicatedCoordinator`).
 */
const isProvisionedByProject = async (db: LobeChatDatabase, agent: CoordinatorAgentRow) => {
  const [labelled] = await db
    .select({ agentId: agentLabelAssignments.agentId })
    .from(agentLabelAssignments)
    .innerJoin(agentLabels, eq(agentLabels.id, agentLabelAssignments.labelId))
    .where(
      and(eq(agentLabelAssignments.agentId, agent.id), eq(agentLabels.name, PROJECT_AGENT_LABEL)),
    )
    .limit(1);
  if (labelled) return true;
  if (!agent.virtual) return false;

  const [grouped] = await db
    .select({ agentId: chatGroupsAgents.agentId })
    .from(chatGroupsAgents)
    .where(eq(chatGroupsAgents.agentId, agent.id))
    .limit(1);
  return !grouped;
};

/** Another project leads it, seats it, or already owns it. */
const isUsedByAnotherProject = async (
  db: LobeChatDatabase,
  projectId: string,
  agent: CoordinatorAgentRow,
) => {
  if (agent.ownerProjectId && agent.ownerProjectId !== projectId) return true;

  const [led] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.coordinatorAgentId, agent.id), ne(projects.id, projectId)))
    .limit(1);
  if (led) return true;

  const [seated] = await db
    .select({ projectId: projectAgents.projectId })
    .from(projectAgents)
    .where(and(eq(projectAgents.agentId, agent.id), ne(projectAgents.projectId, projectId)))
    .limit(1);
  return !!seated;
};

export interface CoordinatorClassification {
  agent: CoordinatorAgentRow | null;
  decision: ProjectCoordinatorOwnershipDecision;
}

/**
 * How a project's main agent relates to the project (design T-14322 §d.3):
 *
 * | decision        | when                                                     | ownership |
 * | --------------- | -------------------------------------------------------- | --------- |
 * | `fallback_null` | no coordinator stored — readers fall back to LobeAI      | never     |
 * | `builtin`       | LobeAI (inbox) or another builtin slug                   | never     |
 * | `user_picked`   | an agent the user made and chose (not provisioned, G1/G2) | never     |
 * | `shared`        | provisioned, but another project leads / seats / owns it | never     |
 * | `owned`         | provisioned for this project and used by no other        | marked    |
 *
 * Only `owned` agents are marked: hiding a shared agent would leave the other
 * projects on an agent nobody can find, and LobeAI / the user's own agents serve
 * conversations outside any project.
 */
export const classifyProjectCoordinator = async (
  db: LobeChatDatabase,
  { agentId, projectId }: { agentId: string | null; projectId: string },
): Promise<CoordinatorClassification> => {
  if (!agentId) return { agent: null, decision: 'fallback_null' };

  const agent = await findCoordinatorAgent(db, agentId);
  if (!agent) return { agent: null, decision: 'fallback_null' };

  // A builtin is never anyone's own, whatever else holds for it.
  if (agent.slug && BUILTIN_SLUGS.has(agent.slug)) return { agent, decision: 'builtin' };

  // Already this project's own (new projects are marked on create).
  if (agent.ownerProjectId === projectId) return { agent, decision: 'owned' };

  if (!(await isProvisionedByProject(db, agent))) return { agent, decision: 'user_picked' };

  if (await isUsedByAnotherProject(db, projectId, agent)) return { agent, decision: 'shared' };

  return { agent, decision: 'owned' };
};

export interface CoordinatorOwnershipBackfillOptions {
  /** Write the log and the ownership marks; `false` only classifies (dry run). */
  apply?: boolean;
  batchSize?: number;
  onBatch?: (progress: CoordinatorOwnershipBackfillProgress & { cursor: string }) => void;
}

export interface CoordinatorOwnershipBackfillProgress {
  /** Projects classified by this run, per decision. */
  decisions: Record<ProjectCoordinatorOwnershipDecision, number>;
  /** Agents newly marked `owner_project_id` by this run. */
  marked: number;
  scanned: number;
}

const emptyDecisions = (): Record<ProjectCoordinatorOwnershipDecision, number> => ({
  builtin: 0,
  fallback_null: 0,
  owned: 0,
  shared: 0,
  user_picked: 0,
});

/**
 * One-off merge of every existing project's coordinator into the
 * project-owned model (design T-14322 §e). For each project not yet in
 * `project_coordinator_ownership_log`:
 *   1. classify its main agent ({@link classifyProjectCoordinator});
 *   2. log the decision with a verbatim snapshot of the agent's configuration
 *      (prompt, model, params, tools, IM connections without credentials);
 *   3. for `owned`, set `agents.owner_project_id` — the only write to `agents`.
 *
 * No configuration field is rewritten, copied or deleted: the agent row already
 * is the one place a coordinator's prompt, model and IM channels live, and after
 * the mark the project settings read and edit exactly that row.
 *
 * Idempotent: a logged project is never re-classified, the log insert is
 * `ON CONFLICT DO NOTHING`, and the mark only fills a NULL `owner_project_id`,
 * so a rerun neither duplicates rows nor overrides anything changed since.
 * Resumable: each batch commits on its own, ordered by project id.
 */
export const backfillProjectCoordinatorOwnership = async (
  db: LobeChatDatabase,
  { apply = true, batchSize = 500, onBatch }: CoordinatorOwnershipBackfillOptions = {},
): Promise<CoordinatorOwnershipBackfillProgress> => {
  const progress: CoordinatorOwnershipBackfillProgress = {
    decisions: emptyDecisions(),
    marked: 0,
    scanned: 0,
  };
  let cursor = '';

  while (true) {
    const done = await db.transaction(async (trx) => {
      const tx = trx as LobeChatDatabase;
      const batch = await tx
        .select({ agentId: projects.coordinatorAgentId, id: projects.id })
        .from(projects)
        .where(
          and(
            gt(projects.id, cursor),
            notExists(
              tx
                .select({ projectId: projectCoordinatorOwnershipLog.projectId })
                .from(projectCoordinatorOwnershipLog)
                .where(eq(projectCoordinatorOwnershipLog.projectId, projects.id)),
            ),
          ),
        )
        .orderBy(asc(projects.id))
        .limit(batchSize)
        .for('update');
      if (batch.length === 0) return true;

      for (const project of batch) {
        progress.scanned += 1;
        const { agent, decision } = await classifyProjectCoordinator(tx, {
          agentId: project.agentId,
          projectId: project.id,
        });
        progress.decisions[decision] += 1;
        if (!apply) continue;

        const [logged] = await tx
          .insert(projectCoordinatorOwnershipLog)
          .values({
            agentId: project.agentId,
            configSnapshot: agent ? await snapshotCoordinatorConfig(tx, agent) : null,
            decision,
            projectId: project.id,
          })
          .onConflictDoNothing()
          .returning({ projectId: projectCoordinatorOwnershipLog.projectId });
        // Logged by a concurrent run in the meantime: that run owns the decision.
        if (!logged || decision !== 'owned' || !agent) continue;

        const marked = await tx
          .update(agents)
          .set({ ownerProjectId: project.id })
          .where(and(eq(agents.id, agent.id), isNull(agents.ownerProjectId)))
          .returning({ id: agents.id });
        if (marked.length === 0) continue;
        progress.marked += 1;
        await tx
          .update(projectCoordinatorOwnershipLog)
          .set({ marked: true })
          .where(eq(projectCoordinatorOwnershipLog.projectId, project.id));
      }

      cursor = batch.at(-1)!.id;
      onBatch?.({ ...progress, cursor });
      return batch.length < batchSize;
    });
    if (done) break;
  }

  return progress;
};

/**
 * Undo the backfill's marks (design T-14322 §e.5): clear `owner_project_id` on
 * every agent the backfill itself marked (`marked`) that still carries that
 * project, and stamp those log rows reverted. The agents reappear in standalone lists with nothing to
 * restore. Ownership written by project creation itself is not in the log and
 * stays. Rerunning is a no-op.
 */
export const revertProjectCoordinatorOwnership = async (db: LobeChatDatabase) =>
  db.transaction(async (trx) => {
    const tx = trx as LobeChatDatabase;
    const cleared = await tx
      .update(agents)
      .set({ ownerProjectId: null })
      .from(projectCoordinatorOwnershipLog)
      .where(
        and(
          eq(projectCoordinatorOwnershipLog.marked, true),
          isNull(projectCoordinatorOwnershipLog.revertedAt),
          eq(agents.id, projectCoordinatorOwnershipLog.agentId),
          eq(agents.ownerProjectId, projectCoordinatorOwnershipLog.projectId),
        ),
      )
      .returning({ id: agents.id });
    await tx
      .update(projectCoordinatorOwnershipLog)
      .set({ revertedAt: sql`now()` })
      .where(
        and(
          eq(projectCoordinatorOwnershipLog.marked, true),
          isNull(projectCoordinatorOwnershipLog.revertedAt),
        ),
      );
    return { cleared: cleared.length };
  });
