import { Flexbox } from '@lobehub/ui';
import isEqual from 'fast-deep-equal';
import { memo } from 'react';

import { dataSelectors, useConversationStore } from '../../store';
import Tool from './Tool';
import { shouldRenderToolCall } from './toolRenderRules';

interface ToolsRendererProps {
  disableEditing?: boolean;
  messageId: string;
}

export const Tools = memo<ToolsRendererProps>(({ disableEditing, messageId }) => {
  // Subscribe only to the visible tool ids of this block. Streaming chunks that
  // change a single tool's args/result do not invalidate this string array, so
  // sibling Tool components stay isolated and only the changed one re-renders.
  const visibleToolCallIds = useConversationStore((s) => {
    const tools = dataSelectors.getToolsInBlock(messageId)(s);
    if (!tools || tools.length === 0) return [];
    return tools.filter(shouldRenderToolCall).map((t) => t.id);
  }, isEqual);

  if (visibleToolCallIds.length === 0) return null;

  return (
    <Flexbox gap={8}>
      {visibleToolCallIds.map((toolCallId) => (
        <Tool
          assistantMessageId={messageId}
          disableEditing={disableEditing}
          id={toolCallId}
          key={toolCallId}
        />
      ))}
    </Flexbox>
  );
});
