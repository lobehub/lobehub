import { Accordion, AccordionItem, ScrollShadow } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import {
  type CSSProperties,
  type ReactNode,
  type RefObject,
  memo,
  useEffect,
  useRef,
  useState,
} from 'react';

import MarkdownMessage from '@/features/Conversation/Markdown';
import { type ChatCitationItem } from '@/types/index';

import Title from './Title';

const styles = createStaticStyles(({ css, cssVar }) => ({
  contentScroll: css`
    max-height: min(40vh, 320px);
    padding-block-end: 8px;
    padding-inline: 8px;
    color: ${cssVar.colorTextDescription};

    article * {
      color: ${cssVar.colorTextDescription};
    }
  `,
}));

interface ThinkingProps {
  citations?: ChatCitationItem[];
  content?: string | ReactNode;
  duration?: number;
  style?: CSSProperties;
  thinking?: boolean;
  thinkingAnimated?: boolean;
}

const Thinking = memo<ThinkingProps>((props) => {
  const { content, duration, thinking, citations, thinkingAnimated } = props;
  const [showDetail, setShowDetail] = useState(false);
  const contentRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setShowDetail(!!thinking);
  }, [thinking]);

  // 当内容变更且正在思考时，如果用户接近底部则自动滚动到底部
  useEffect(() => {
    if (!thinking || !showDetail) return;
    const container = contentRef.current;
    if (!container) return;

    // 仅当用户接近底部时才自动滚动，避免打断用户查看上方内容
    const distanceToBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    const isNearBottom = distanceToBottom < 120;

    if (isNearBottom) {
      requestAnimationFrame(() => {
        container.scrollTop = container.scrollHeight;
      });
    }
  }, [content, thinking, showDetail]);

  // 展开时滚动到底部，便于查看最新内容
  useEffect(() => {
    if (!showDetail) return;
    const container = contentRef.current;
    if (!container) return;
    requestAnimationFrame(() => {
      container.scrollTop = container.scrollHeight;
    });
  }, [showDetail]);

  return (
    <Accordion
      expandedKeys={showDetail ? ['thinking'] : []}
      gap={8}
      onExpandedChange={(keys) => setShowDetail(keys.length > 0)}
    >
      <AccordionItem
        itemKey={'thinking'}
        paddingBlock={4}
        paddingInline={4}
        title={<Title duration={duration} showDetail={showDetail} thinking={thinking} />}
      >
        <ScrollShadow
          className={styles.contentScroll}
          offset={12}
          ref={contentRef as unknown as RefObject<HTMLDivElement>}
          size={12}
        >
          {typeof content === 'string' ? (
            <MarkdownMessage
              animated={thinkingAnimated}
              citations={citations}
              style={{
                overflow: 'unset',
              }}
              variant={'chat'}
            >
              {content}
            </MarkdownMessage>
          ) : (
            content
          )}
        </ScrollShadow>
      </AccordionItem>
    </Accordion>
  );
});

export default Thinking;
