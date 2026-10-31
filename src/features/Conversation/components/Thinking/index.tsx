import { Accordion, cx, ScrollArea } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import type { CSSProperties, ReactNode, RefObject } from 'react';
import { memo, useEffect, useState } from 'react';

import MarkdownMessage from '@/features/Conversation/Markdown';
import { useAutoScroll } from '@/hooks/useAutoScroll';
import { type ChatCitationItem } from '@/types/index';

import contentStyles from './index.module.css';
import Title from './Title';

const styles = stylex.create({
  contentScroll: {
    maxHeight: 'min(40vh, 320px)',
    paddingBlockEnd: '8px',
    paddingInline: '8px',
    color: cssVar.colorTextDescription,
  },
  scrollRoot: {
    borderRadius: 0,
    backgroundColor: 'transparent',
    backgroundImage: 'none',
  },
});

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
      gap={8}
      indicatorPlacement="inline"
      styles={{ trigger: { paddingBlock: 4, paddingInline: 4 } }}
      value={showDetail ? ['thinking'] : []}
      items={[
        {
          children: (
            <ScrollArea
              disableContentFit
              scrollFade
              className={stylex.props(styles.scrollRoot).className}
              viewportProps={{
                className: cx(
                  stylex.props(styles.contentScroll).className,
                  contentStyles.contentScroll,
                ),
                ref: ref as RefObject<HTMLDivElement>,
                onScroll: handleScroll,
              }}
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
            </ScrollArea>
          ),
          key: 'thinking',
          title: <Title duration={duration} showDetail={showDetail} thinking={thinking} />,
        },
      ]}
      onValueChange={(keys) => setShowDetail(keys.length > 0)}
    />
  );
});

export default Thinking;
