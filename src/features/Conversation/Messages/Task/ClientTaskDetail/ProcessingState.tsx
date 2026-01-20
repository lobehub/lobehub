'use client';

import { type AssistantContentBlock } from '@lobechat/types';
import { Flexbox, ScrollShadow } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { type RefObject, memo } from 'react';

import { useAutoScroll } from '@/hooks/useAutoScroll';

import ContentBlock from '../../AssistantGroup/components/ContentBlock';

const styles = createStaticStyles(({ css }) => ({
  contentScroll: css`
    max-height: min(50vh, 400px);
  `,
}));

interface ProcessingStateProps {
  assistantId: string;
  blocks: AssistantContentBlock[];
}

const ProcessingState = memo<ProcessingStateProps>(({ blocks, assistantId }) => {
  const { ref, handleScroll } = useAutoScroll<HTMLDivElement>({
    deps: [blocks],
    enabled: true,
  });

  return (
    <ScrollShadow
      className={styles.contentScroll}
      offset={12}
      onScroll={handleScroll}
      ref={ref as RefObject<HTMLDivElement>}
      size={12}
    >
      <Flexbox gap={8}>
        {blocks.map((block) => (
          <ContentBlock {...block} assistantId={assistantId} disableEditing key={block.id} />
        ))}
      </Flexbox>
    </ScrollShadow>
  );
});

ProcessingState.displayName = 'ClientProcessingState';

export default ProcessingState;
