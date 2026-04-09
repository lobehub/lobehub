import type { ModelReasoning } from '@lobechat/types';
import { deserializeParts } from '@lobechat/utils';
import { memo, useMemo } from 'react';

import Thinking from '@/features/Conversation/components/Thinking';
import { useUserStore } from '@/store/user';
import { userGeneralSettingsSelectors } from '@/store/user/selectors';

import { messageStateSelectors, useConversationStore } from '../../../store';
import { RichContentRenderer } from '../../components/RichContentRenderer';

interface WorkflowReasoningLineProps {
  id: string;
  reasoning: ModelReasoning;
}

const WorkflowReasoningLine = memo<WorkflowReasoningLineProps>(({ id, reasoning }) => {
  const isReasoning = useConversationStore(messageStateSelectors.isMessageInReasoning(id));
  const transitionMode = useUserStore(userGeneralSettingsSelectors.transitionMode);

  const contentStr = reasoning.content ?? '';
  const parts = useMemo(
    () => reasoning.tempDisplayContent || deserializeParts(contentStr),
    [contentStr, reasoning.tempDisplayContent],
  );

  const thinkingContent =
    reasoning.isMultimodal && parts ? <RichContentRenderer parts={parts} /> : contentStr;

  const hasReadableContent =
    (typeof thinkingContent === 'string' && thinkingContent.trim() !== '') ||
    !!(reasoning.isMultimodal && parts && parts.length > 0);

  const hasDuration = (reasoning.duration ?? 0) > 0;

  if (!isReasoning && !hasReadableContent && !hasDuration) return null;

  return (
    <Thinking
      content={thinkingContent}
      duration={reasoning.duration}
      thinking={isReasoning}
      thinkingAnimated={transitionMode === 'fadeIn' && isReasoning}
    />
  );
});

WorkflowReasoningLine.displayName = 'WorkflowReasoningLine';

export default WorkflowReasoningLine;
