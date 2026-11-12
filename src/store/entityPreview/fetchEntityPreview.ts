import type { VerifyCodingScope } from '@lobechat/types';

import { agentService } from '@/services/agent';
import { documentService } from '@/services/document';
import { goalService } from '@/services/goal';
import { taskService } from '@/services/task';
import { verifyService } from '@/services/verify';
import type { AgentItem } from '@/types/agent';
import { isTrpcErrorCode } from '@/utils/trpcError';

import { clipDescription, type EntityPreview, type EntityPreviewParams } from './projection';

/** Read one linked entity and keep only what its preview paints. */
const readEntityPreview = async ({
  id,
  type,
}: EntityPreviewParams): Promise<EntityPreview | null> => {
  switch (type) {
    case 'acceptance': {
      const bundle = await verifyService.getAcceptanceBundle(id);
      if (!bundle) return null;

      return {
        acceptance: {
          exceptions: bundle.checks.filter(
            (check) => check.state === 'failed' || check.state === 'uncertain',
          ).length,
          passed: bundle.checks.filter((check) => check.state === 'passed').length,
          rounds: bundle.rounds.length,
          total: bundle.checks.length,
        },
        description: clipDescription(bundle.acceptance.requirement || bundle.latestReport?.summary),
        title: bundle.subject.title || bundle.subject.id,
      };
    }
    case 'agent': {
      // The agent row: its config plus the meta (description) the card shows.
      const agent = (await agentService.getAgentConfigById(id)) as Partial<AgentItem> | null;
      if (!agent) return null;

      return {
        avatar: agent.avatar,
        backgroundColor: agent.backgroundColor,
        description: clipDescription(agent.description),
        title: agent.title,
      };
    }
    case 'document': {
      const document = await documentService.getDocumentById(id);
      if (!document) return null;

      return {
        description: clipDescription(document.content),
        title: document.title || document.filename,
      };
    }
    case 'goal': {
      const { decisions, goal, nodes } = await goalService.getGraph(id);
      const tasks = nodes.filter((node) => node.kind === 'task');

      return {
        description: clipDescription(goal.requirement),
        goal: {
          done: tasks.filter((node) => ['rejected', 'resolved', 'retired'].includes(node.status))
            .length,
          pendingDecisions: decisions.filter((decision) => decision.status === 'pending').length,
          status: goal.status,
          total: tasks.length,
        },
        title: goal.title,
      };
    }
    case 'task': {
      const task = (await taskService.getDetail(id)).data;
      if (!task) return null;

      return {
        description: clipDescription(task.description || task.instruction),
        title: task.name || task.identifier,
      };
    }
    case 'verify': {
      const bundle = await verifyService.getReportBundle(id);
      if (!bundle) return null;

      const { report, run } = bundle;
      // Branch/commit chips only exist on a coding scope (a run with no
      // scenario predates the column and is coding); testedAt is shared.
      const codingScope =
        (run.scenario ?? 'coding') === 'coding' ? (run.context as VerifyCodingScope | null) : null;

      return {
        description: clipDescription(report?.summary),
        title: run.title,
        verify: {
          branch: codingScope?.branch,
          commit: codingScope?.commit?.slice(0, 10),
          counts: report
            ? {
                failed: report.failedChecks ?? 0,
                passed: report.passedChecks ?? 0,
                uncertain: report.uncertainChecks ?? 0,
              }
            : undefined,
          status: report?.verdict ?? run.status,
          testedAt: (run.context as { testedAt?: string } | null)?.testedAt,
        },
      };
    }
  }
};

/**
 * {@link readEntityPreview}, answering `null` when the entity is gone or no
 * longer visible to the viewer: some reads (a goal graph) reject instead of
 * resolving to nothing, and either way the remembered preview must go.
 */
export const fetchEntityPreview = async (
  params: EntityPreviewParams,
): Promise<EntityPreview | null> => {
  try {
    return await readEntityPreview(params);
  } catch (error) {
    if (isTrpcErrorCode(error, 'NOT_FOUND') || isTrpcErrorCode(error, 'FORBIDDEN')) return null;
    throw error;
  }
};
