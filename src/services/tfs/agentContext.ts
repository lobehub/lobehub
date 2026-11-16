import type { RuntimeInitialContext } from '@lobechat/types';

import { tfsService } from '@/services/tfs';

/** Metadata is refreshed every turn; credentials and project state are never cached here. */
export const loadTfsAgentContext = async (topicId?: string | null): Promise<string | undefined> => {
  if (!topicId) return;
  try {
    return (await tfsService.agentContext(topicId)) ?? undefined;
  } catch (error) {
    console.error('Unable to load TFS repository context', error);
    return;
  }
};
export const withTfsInitialContext = async (
  initialContext: RuntimeInitialContext | undefined,
  topicId?: string | null,
  shareVisitor = false,
): Promise<RuntimeInitialContext | undefined> => {
  if (shareVisitor) return initialContext;
  const tfs = await loadTfsAgentContext(topicId);
  if (!tfs) return initialContext;
  return {
    ...initialContext,
    projectContext: {
      contextPrompt: [initialContext?.projectContext?.contextPrompt, tfs]
        .filter(Boolean)
        .join('\n\n'),
    },
  };
};
