import { Accordion, AccordionItem, ScrollShadow } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { type CSSProperties, type ReactNode, type RefObject } from 'react';
import { memo, useEffect, useState } from 'react';

import MarkdownMessage from '@/features/Conversation/Markdown';
import { useAutoScroll } from '@/hooks/useAutoScroll';
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

  const { ref, handleScroll } = useAutoScroll<HTMLDivElement>({
    deps: [content, showDetail],
    enabled: thinking && showDetail,
    threshold: 120,
  });

  useEffect(() => {
    setShowDetail(!!thinking);
  }, [thinking]);

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
          ref={ref as RefObject<HTMLDivElement>}
          size={12}
          onScroll={handleScroll}
        >
          {typeof content === 'string' ? (
            <MarkdownMessage
              animated={thinkingAnimated}
              citations={citations}
              variant={'chat'}
              style={{
                overflow: 'unset',
              }}
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
