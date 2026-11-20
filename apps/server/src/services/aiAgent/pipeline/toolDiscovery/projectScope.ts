import debug from 'debug';

import { ProjectModel } from '@/database/models/project';

import { traceDiscoveryStage } from '../discoveryTracing';
import type { ToolDiscoveryDeps } from './types';

const log = debug('lobe-server:ai-agent-service');

export interface ProjectToolScope {
  /** The project links at least one enabled knowledge base the caller can read. */
  hasKnowledgeBases: boolean;
  /** The run's agent coordinates the project, so it plans work as tasks. */
  isCoordinator: boolean;
}

const NO_PROJECT: ProjectToolScope = { hasKnowledgeBases: false, isCoordinator: false };

/**
 * What the project a run belongs to adds to its tool surface. Knowledge linked
 * to the project is searchable by every agent working there, so the knowledge
 * tool must appear even when the agent has none of its own; the coordinator
 * also gets the task tool it delegates through. A failed read degrades to the
 * agent's own surface rather than failing the run.
 */
export const readProjectToolScope = async (
  deps: ToolDiscoveryDeps,
  ctx: { projectId?: string; resolvedAgentId: string },
): Promise<ProjectToolScope> => {
  const { projectId } = ctx;
  if (!projectId) return NO_PROJECT;

  try {
    return await traceDiscoveryStage('project_scope', async () => {
      const projectModel = new ProjectModel(deps.db, deps.userId, deps.workspaceId);
      const [project, knowledgeBaseIds] = await Promise.all([
        projectModel.findById(projectId),
        projectModel.getEnabledKnowledgeBaseIds(projectId),
      ]);
      if (!project) return NO_PROJECT;
      // A cleared main agent falls back to LobeAI, the same as every project read.
      const [{ coordinatorAgentId }] = await projectModel.resolveCoordinatorAgents([project]);
      return {
        hasKnowledgeBases: knowledgeBaseIds.length > 0,
        isCoordinator: coordinatorAgentId === ctx.resolvedAgentId,
      };
    });
  } catch (error) {
    log('execAgent: failed to read project tool scope for %s: %O', projectId, error);
    return NO_PROJECT;
  }
};
