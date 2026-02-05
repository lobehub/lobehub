import { Flexbox } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import isEqual from 'fast-deep-equal';
import { memo, useMemo } from 'react';

import type {AssistantContentBlock} from '@/types/index';

import { messageStateSelectors, useConversationStore } from '../../../store';
import { MessageAggregationContext } from '../../Contexts/MessageAggregationContext';
import { CollapsedMessage } from './CollapsedMessage';
import ContentBlock from './ContentBlock';

const styles = createStaticStyles(({ css }) => {
  return {
    container: css`
      &:has(.tool-blocks) {
        width: 100%;
      }
    `,
  };
});

interface GroupChildrenProps {
  blocks: AssistantContentBlock[];
  content?: string;
  contentId?: string;
  disableEditing?: boolean;
  id: string;
  messageIndex: number;
}

const Group = memo<GroupChildrenProps>(({ blocks, id, content, disableEditing }) => {
  const isCollapsed = useConversationStore(messageStateSelectors.isMessageCollapsed(id));
  const contextValue = useMemo(() => ({ assistantGroupId: id }), [id]);

  if (isCollapsed) {
    return (
      content && (
        <Flexbox>
          <CollapsedMessage content={content} id={id} />
        </Flexbox>
      )
    );
  }
  return (
    <MessageAggregationContext value={contextValue}>
      <Flexbox className={styles.container} gap={8}>
        {blocks.map((item) => {
          return (
            <ContentBlock {...item} disableEditing={disableEditing} key={id + '.' + item.id} />
          );
        })}
      </Flexbox>
    </MessageAggregationContext>
  );
}, isEqual);

export default Group;
