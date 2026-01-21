'use client';

import { type AssistantContentBlock } from '@lobechat/types';
import { Block, Flexbox, ScrollShadow, Text } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { type RefObject, memo, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import NeuralNetworkLoading from '@/components/NeuralNetworkLoading';
import AnimatedNumber from '@/features/Conversation/Messages/components/Extras/Usage/UsageDetail/AnimatedNumber';
import { useAutoScroll } from '@/hooks/useAutoScroll';

import ContentBlock from '../../AssistantGroup/components/ContentBlock';
import { accumulateUsage, formatElapsedTime } from '../../Tasks/shared/utils';
import Usage from '../../components/Extras/Usage';

const styles = createStaticStyles(({ css }) => ({
  contentScroll: css`
    max-height: min(50vh, 300px);
  `,
}));

interface ProcessingStateProps {
  assistantId: string;
  blocks: AssistantContentBlock[];
  model?: string;
  provider?: string;
  startTime?: number;
}

const ProcessingState = memo<ProcessingStateProps>(
  ({ blocks, assistantId, startTime, model, provider }) => {
    const { t } = useTranslation('chat');
    const [elapsedTime, setElapsedTime] = useState(0);
    const { ref, handleScroll } = useAutoScroll<HTMLDivElement>({
      deps: [blocks],
      enabled: true,
    });

    const totalToolCalls = useMemo(
      () => blocks.reduce((sum, block) => sum + (block.tools?.length || 0), 0),
      [blocks],
    );

    // Accumulate usage from all blocks
    const accumulatedUsage = useMemo(() => accumulateUsage(blocks), [blocks]);

    // Calculate initial elapsed time
    useEffect(() => {
      if (startTime) {
        setElapsedTime(Math.max(0, Date.now() - startTime));
      }
    }, [startTime]);

    // Timer for updating elapsed time every second
    useEffect(() => {
      if (!startTime) return;

      const timer = setInterval(() => {
        setElapsedTime(Math.max(0, Date.now() - startTime));
      }, 1000);

      return () => clearInterval(timer);
    }, [startTime]);

    return (
      <Flexbox gap={8}>
        <Flexbox align="center" gap={8} horizontal paddingInline={4}>
          <Block
            align="center"
            flex="none"
            gap={4}
            height={24}
            horizontal
            justify="center"
            style={{ fontSize: 12 }}
            variant="outlined"
            width={24}
          >
            <NeuralNetworkLoading size={16} />
          </Block>
          <Flexbox align="center" gap={4} horizontal>
            <Text as="span" type="secondary" weight={500}>
              <AnimatedNumber
                duration={500}
                formatter={(v) => Math.round(v).toString()}
                value={totalToolCalls}
              />
            </Text>
            <Text as="span" type="secondary">
              {t('task.metrics.toolCallsShort')}
            </Text>
            {startTime && (
              <Text as="span" type="secondary">
                ({formatElapsedTime(elapsedTime)})
              </Text>
            )}
          </Flexbox>
        </Flexbox>
        <ScrollShadow
          className={styles.contentScroll}
          offset={12}
          onScroll={handleScroll}
          ref={ref as RefObject<HTMLDivElement>}
          size={8}
        >
          <Flexbox gap={8}>
            {blocks.map((block) => (
              <ContentBlock {...block} assistantId={assistantId} disableEditing key={block.id} />
            ))}
          </Flexbox>
        </ScrollShadow>

        {/* Usage display */}
        {model && provider && <Usage model={model} provider={provider} usage={accumulatedUsage} />}
      </Flexbox>
    );
  },
);

ProcessingState.displayName = 'ClientProcessingState';

export default ProcessingState;
