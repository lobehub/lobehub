'use client';

import type { UIChatMessage } from '@lobechat/types';
import { Flexbox, ScrollShadow } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { memo, type RefObject, useMemo } from 'react';

import { resolveAssistantGroupFromMessages } from '../utils/resolveAssistantGroupFromMessages';
import ContentBlock from './ContentBlock';
import type { RenderableAssistantContentBlock } from './types';

const styles = createStaticStyles(({ css }) => ({
  scrollTask: css`
    max-height: min(50vh, 300px);
  `,
  scrollWorkflow: css`
    max-height: min(40vh, 320px);
  `,
}));

interface ContentBlocksScrollBaseProps {
  disableEditing?: boolean;
  onScroll?: () => void;
  scroll?: boolean;
  scrollRef?: RefObject<HTMLDivElement | null>;
  variant: 'task' | 'workflow';
}

interface ContentBlocksScrollFromBlocks extends ContentBlocksScrollBaseProps {
  assistantId: string;
  blocks: RenderableAssistantContentBlock[];
  messages?: never;
}

interface ContentBlocksScrollFromMessages extends ContentBlocksScrollBaseProps {
  assistantId?: never;
  blocks?: never;
  messages: UIChatMessage[];
}

export type ContentBlocksScrollProps =
  | ContentBlocksScrollFromBlocks
  | ContentBlocksScrollFromMessages;

const ContentBlocksScroll = memo<ContentBlocksScrollProps>((props) => {
  const { disableEditing, onScroll, scroll = true, scrollRef, variant } = props;

  const messagesList = 'messages' in props ? props.messages : undefined;
  const assistantIdFromProps = 'messages' in props ? undefined : props.assistantId;
  const blocksFromProps = 'messages' in props ? undefined : props.blocks;

  const { assistantId, blocks } = useMemo<{
    assistantId: string;
    blocks: RenderableAssistantContentBlock[];
  }>(() => {
    if (messagesList !== undefined) {
      return resolveAssistantGroupFromMessages(messagesList);
    }
    return {
      assistantId: assistantIdFromProps ?? '',
      blocks: blocksFromProps ?? [],
    };
  }, [assistantIdFromProps, blocksFromProps, messagesList]);

  const list = (
    <Flexbox gap={8}>
      {blocks.map((block) => (
        <ContentBlock
          key={block.renderKey ?? block.id}
          {...block}
          assistantId={assistantId}
          disableEditing={disableEditing}
        />
      ))}
    </Flexbox>
  );

  const body = variant === 'workflow' ? <Flexbox paddingBlock={'4px 8px'}>{list}</Flexbox> : list;

  if (!scroll) {
    return body;
  }

  const scrollClass = variant === 'task' ? styles.scrollTask : styles.scrollWorkflow;
  const shadowSize = variant === 'task' ? 8 : 12;

  return (
    <ScrollShadow
      className={scrollClass}
      offset={12}
      ref={scrollRef as RefObject<HTMLDivElement>}
      size={shadowSize}
      onScroll={onScroll}
    >
      {body}
    </ScrollShadow>
  );
});

ContentBlocksScroll.displayName = 'ContentBlocksScroll';

export default ContentBlocksScroll;
