import { Flexbox } from '@lobehub/ui';
import isEqual from 'fast-deep-equal';
import { memo } from 'react';

import { useConversationStore } from '../../../store';
import ContentBlock from './ContentBlock';
import type { RenderableAssistantContentBlock } from './types';

interface GroupItemProps extends RenderableAssistantContentBlock {
  assistantId: string;
  contentId?: string;
  disableEditing?: boolean;
  isFirstBlock?: boolean;
  messageIndex: number;
}

const GroupItem = memo<GroupItemProps>(
  ({ contentId, disableEditing, error, assistantId, isFirstBlock, ...item }) => {
    const toggleMessageEditing = useConversationStore((s) => s.toggleMessageEditing);

    return item.id === contentId ? (
      <Flexbox
        onDoubleClick={(e) => {
          if (disableEditing || error || !e.altKey) return;
          toggleMessageEditing(item.id, true);
        }}
      >
        <ContentBlock
          {...item}
          assistantId={assistantId}
          disableEditing={disableEditing}
          error={error}
          isFirstBlock={isFirstBlock}
        />
      </Flexbox>
    ) : (
      <ContentBlock
        {...item}
        assistantId={assistantId}
        disableEditing={disableEditing}
        error={error}
        isFirstBlock={isFirstBlock}
      />
    );
  },
  isEqual,
);

export default GroupItem;
