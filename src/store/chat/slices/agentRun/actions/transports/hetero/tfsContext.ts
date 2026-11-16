import type { ConversationContext } from '@lobechat/types';

import { loadTfsAgentContext } from '@/services/tfs/agentContext';

import { withHeteroContext as withBaseHeteroContext } from '../viewedTaskPrompt';

/** Desktop CLI runs bypass server dispatch, so obtain DevOps metadata through its scoped RPC. */
export const withHeteroContext = async (
  provider: { systemContext?: string },
  message: string,
  context: Pick<
    ConversationContext,
    'agentShareId' | 'defaultTaskAssigneeAgentId' | 'topicId' | 'viewedTask'
  >,
): Promise<string | undefined> => {
  const base = withBaseHeteroContext(provider.systemContext, message, context);
  if (!context.topicId || context.agentShareId) return base;
  const tfs = await loadTfsAgentContext(context.topicId);
  return tfs ? [base, tfs].filter(Boolean).join('\n\n') : base;
};
