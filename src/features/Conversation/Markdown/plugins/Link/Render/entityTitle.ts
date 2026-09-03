import { agentService } from '@/services/agent';
import { taskService } from '@/services/task';
import { verifyService } from '@/services/verify';

import type { InternalLinkReference } from '../internalLink';

export const internalEntityTitleKey = (reference: InternalLinkReference) => [
  'internal-entity-title',
  reference.type,
  reference.pathname,
];

/**
 * Resolve just the entity's display title, for swapping a pasted URL label.
 *
 * This runs EAGERLY for every bare internal link in a message, so each branch
 * must stay a bounded read — acceptance and verify have title-only header
 * endpoints for exactly this, and task/agent are single-row reads already.
 * Documents have no read that skips the full content, so a bare document link
 * keeps its URL and resolves only in the on-demand hover preview.
 */
export const getEntityTitle = async (reference: InternalLinkReference): Promise<string | null> => {
  switch (reference.type) {
    case 'acceptance': {
      const header = await verifyService.getAcceptanceHeader(reference.acceptanceId);
      return header?.title ?? null;
    }
    case 'agent': {
      const agent = await agentService.getAgentConfigById(reference.agentId);
      return agent?.title ?? null;
    }
    case 'task': {
      const task = (await taskService.getDetail(reference.taskId)).data;
      return task ? task.name || task.identifier || null : null;
    }
    case 'verify': {
      const header = await verifyService.getRunHeader(reference.runId);
      return header?.title ?? null;
    }
    default: {
      return null;
    }
  }
};
