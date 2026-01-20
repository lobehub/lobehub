'use client';

import { type AssistantContentBlock } from '@lobechat/types';
import { Accordion, AccordionItem, Block, Flexbox, Icon, Text } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { Workflow } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import ContentBlock from '../../AssistantGroup/components/ContentBlock';
import { formatDuration } from '../../Tasks/shared/utils';
import Usage from '../../components/Extras/Usage';

interface CompletedStateProps {
  assistantId: string;
  blocks: AssistantContentBlock[];
  duration?: number;
  model?: string;
  provider?: string;
  totalCost?: number;
  totalTokens?: number;
  totalToolCalls?: number;
}

const CompletedState = memo<CompletedStateProps>(
  ({ blocks, assistantId, duration, totalToolCalls, model, provider, totalTokens, totalCost }) => {
    const { t } = useTranslation('chat');

    // Split blocks: intermediate steps (all but last) and final result (last)
    const { intermediateBlocks, finalBlock } = useMemo(() => {
      if (blocks.length === 0) return { finalBlock: null, intermediateBlocks: [] };
      if (blocks.length === 1) return { finalBlock: blocks[0], intermediateBlocks: [] };

      return {
        finalBlock: blocks.at(-1)!,
        intermediateBlocks: blocks.slice(0, -1),
      };
    }, [blocks]);

    if (!finalBlock) return null;

    const title = (
      <Flexbox align="center" gap={8} horizontal>
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
          <Icon color={cssVar.colorTextSecondary} icon={Workflow} />
        </Block>
        <Flexbox align="center" gap={4} horizontal>
          <Text as="span" type="secondary" weight={500}>
            {totalToolCalls}
          </Text>
          <Text as="span" type="secondary">
            {t('task.metrics.toolCallsShort')}
          </Text>
          {/* Duration display */}
          {duration && (
            <Text as="span" type="secondary">
              {t('task.metrics.duration', { duration: formatDuration(duration) })}
            </Text>
          )}
        </Flexbox>
      </Flexbox>
    );

    return (
      <Flexbox gap={8}>
        {/* Intermediate steps - collapsed by default */}
        {intermediateBlocks.length > 0 && (
          <Accordion defaultExpandedKeys={[]} gap={8}>
            <AccordionItem itemKey="intermediate" paddingBlock={4} paddingInline={4} title={title}>
              <Flexbox gap={8} paddingInline={4} style={{ marginTop: 8 }}>
                {intermediateBlocks.map((block) => (
                  <ContentBlock
                    {...block}
                    assistantId={assistantId}
                    disableEditing
                    key={block.id}
                  />
                ))}
              </Flexbox>
            </AccordionItem>
          </Accordion>
        )}

        {/* Final result - always visible */}
        <ContentBlock {...finalBlock} assistantId={assistantId} disableEditing />

        {/* Usage display */}
        {model && provider && (
          <Usage model={model} provider={provider} usage={{ cost: totalCost, totalTokens }} />
        )}
      </Flexbox>
    );
  },
);

CompletedState.displayName = 'ClientCompletedState';

export default CompletedState;
