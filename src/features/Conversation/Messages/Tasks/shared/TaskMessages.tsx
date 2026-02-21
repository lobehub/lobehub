'use client';

import { type AssistantContentBlock, type UIChatMessage } from '@lobechat/types';
import {
  Accordion,
  AccordionItem,
  Block,
  Flexbox,
  Icon,
  Markdown,
  ScrollShadow,
  Text,
} from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { ScrollText, Workflow } from 'lucide-react';
import { type RefObject } from 'react';
import { memo, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import NeuralNetworkLoading from '@/components/NeuralNetworkLoading';
import { useAutoScroll } from '@/hooks/useAutoScroll';

import ContentBlock from '../../AssistantGroup/components/ContentBlock';
import Usage from '../../components/Extras/Usage';
import AnimatedNumber from '../../components/Extras/Usage/UsageDetail/AnimatedNumber';
import { accumulateUsage, formatDuration, formatElapsedTime } from './utils';

const styles = createStaticStyles(({ css }) => ({
  contentScroll: css`
    max-height: min(50vh, 300px);
  `,
  instructionContent: css`
    overflow: auto;
    max-height: 300px;
  `,
}));

/**
 * InstructionAccordion - Shows the task instruction in a collapsible accordion
 */
const InstructionAccordion = memo<{ childrenCount: number; instruction: string }>(
  ({ instruction, childrenCount }) => {
    const { t } = useTranslation('chat');

    // Auto-collapse instruction when children count exceeds threshold
    const [expandedKeys, setExpandedKeys] = useState<string[]>(['instruction']);

    useEffect(() => {
      if (childrenCount > 1) {
        setExpandedKeys([]);
      }
    }, [childrenCount > 1]);

    return (
      <Accordion
        expandedKeys={expandedKeys}
        gap={8}
        onExpandedChange={(keys) => setExpandedKeys(keys as string[])}
      >
        <AccordionItem
          itemKey="instruction"
          paddingBlock={4}
          paddingInline={4}
          title={
            <Flexbox horizontal align="center" gap={8}>
              <Block
                horizontal
                align="center"
                flex="none"
                gap={4}
                height={24}
                justify="center"
                style={{ fontSize: 12 }}
                variant="outlined"
                width={24}
              >
                <Icon color={cssVar.colorTextSecondary} icon={ScrollText} />
              </Block>
              <Text as="span" type="secondary">
                {t('task.instruction')}
              </Text>
            </Flexbox>
          }
        >
          <Block
            className={styles.instructionContent}
            padding={12}
            style={{ marginBlock: 8 }}
            variant={'outlined'}
          >
            <Markdown variant={'chat'}>{instruction}</Markdown>
          </Block>
        </AccordionItem>
      </Accordion>
    );
  },
);

InstructionAccordion.displayName = 'InstructionAccordion';

interface TaskMessagesProps {
  /**
   * Task duration in ms (for completed state)
   */
  duration?: number;
  /**
   * Whether the task is currently processing
   */
  isProcessing?: boolean;
  /**
   * Messages from task execution (parsed by conversation-flow)
   * Will extract assistantGroup.children as blocks for rendering
   */
  messages: UIChatMessage[];
  /**
   * Model name for usage display
   */
  model?: string;
  /**
   * Provider name for usage display
   */
  provider?: string;
  /**
   * Task start time for elapsed time calculation
   */
  startTime?: number;
  /**
   * Total cost (for completed state)
   */
  totalCost?: number;
}

/**
 * Processing state - shows all blocks with loading indicator
 */
const ProcessingView = memo<{
  accumulatedUsage: { cost?: number; totalTokens?: number };
  assistantId: string;
  blocks: AssistantContentBlock[];
  model?: string;
  provider?: string;
  startTime?: number;
  totalToolCalls: number;
}>(({ blocks, assistantId, startTime, model, provider, totalToolCalls, accumulatedUsage }) => {
  const { t } = useTranslation('chat');
  const [elapsedTime, setElapsedTime] = useState(0);
  const { ref, handleScroll } = useAutoScroll<HTMLDivElement>({
    deps: [blocks],
    enabled: true,
  });

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
      <Flexbox horizontal align="center" gap={8} paddingInline={4}>
        <Block
          horizontal
          align="center"
          flex="none"
          gap={4}
          height={24}
          justify="center"
          style={{ fontSize: 12 }}
          variant="outlined"
          width={24}
        >
          <NeuralNetworkLoading size={16} />
        </Block>
        <Flexbox horizontal align="center" gap={4}>
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
        ref={ref as RefObject<HTMLDivElement>}
        size={8}
        onScroll={handleScroll}
      >
        <Flexbox gap={8}>
          {blocks.map((block) => (
            <ContentBlock {...block} disableEditing assistantId={assistantId} key={block.id} />
          ))}
        </Flexbox>
      </ScrollShadow>

      {/* Usage display */}
      {model && provider && <Usage model={model} provider={provider} usage={accumulatedUsage} />}
    </Flexbox>
  );
});

ProcessingView.displayName = 'ProcessingView';

/**
 * Completed state - shows intermediate steps in accordion, final result visible
 */
const CompletedView = memo<{
  assistantId: string;
  blocks: AssistantContentBlock[];
  duration?: number;
  model?: string;
  provider?: string;
  totalCost?: number;
  totalTokens?: number;
  totalToolCalls: number;
}>(({ blocks, assistantId, duration, totalToolCalls, model, provider, totalTokens, totalCost }) => {
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
    <Flexbox horizontal align="center" gap={8}>
      <Block
        horizontal
        align="center"
        flex="none"
        gap={4}
        height={24}
        justify="center"
        style={{ fontSize: 12 }}
        variant="outlined"
        width={24}
      >
        <Icon color={cssVar.colorTextSecondary} icon={Workflow} />
      </Block>
      <Flexbox horizontal align="center" gap={4}>
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
                <ContentBlock {...block} disableEditing assistantId={assistantId} key={block.id} />
              ))}
            </Flexbox>
          </AccordionItem>
        </Accordion>
      )}

      {/* Final result - always visible */}
      <ContentBlock {...finalBlock} disableEditing assistantId={assistantId} />

      {/* Usage display */}
      {model && provider && (
        <Usage model={model} provider={provider} usage={{ cost: totalCost, totalTokens }} />
      )}
    </Flexbox>
  );
});

CompletedView.displayName = 'CompletedView';

/**
 * TaskMessages - Renders task execution messages (blocks) for both processing and completed states
 *
 * Extracts assistantGroup.children (blocks) from messages and renders them:
 * - Processing: Shows all blocks with loading indicator and real-time updates
 * - Completed: Shows intermediate steps in accordion, final result always visible
 */
const TaskMessages = memo<TaskMessagesProps>(
  ({ messages, isProcessing = false, startTime, duration, model, provider, totalCost }) => {
    // Extract blocks and instruction from messages
    const { blocks, assistantId, instruction } = useMemo(() => {
      if (!messages || messages.length === 0)
        return { assistantId: '', blocks: [], instruction: undefined };

      const assistantGroupMessage = messages.find((item) => item.role === 'assistantGroup');
      const userMessage = messages.find((item) => item.role === 'user');

      // If assistantGroup exists, use its children as blocks
      if (assistantGroupMessage) {
        return {
          assistantId: assistantGroupMessage.id ?? '',
          blocks: assistantGroupMessage.children ?? [],
          instruction: userMessage?.content,
        };
      }

      // Fallback: support plain assistant message (without tools)
      // This handles cases where SubAgent returns a simple text response
      const assistantMessage = messages.find((item) => item.role === 'assistant');
      if (assistantMessage) {
        // Convert plain assistant message to block format
        const block: AssistantContentBlock = {
          content: assistantMessage.content || '',
          id: assistantMessage.id,
        };

        // Copy optional fields if they exist
        if (assistantMessage.error) block.error = assistantMessage.error;
        if (assistantMessage.reasoning) block.reasoning = assistantMessage.reasoning;

        return {
          assistantId: assistantMessage.id ?? '',
          blocks: [block],
          instruction: userMessage?.content,
        };
      }

      return { assistantId: '', blocks: [], instruction: undefined };
    }, [messages]);

    // Calculate total tool calls
    const totalToolCalls = useMemo(
      () => blocks.reduce((sum, block) => sum + (block.tools?.length || 0), 0),
      [blocks],
    );

    // Accumulate usage from all blocks
    const accumulatedUsage = useMemo(() => accumulateUsage(blocks), [blocks]);

    return (
      <Flexbox gap={4}>
        {/* Instruction accordion */}
        {instruction && (
          <InstructionAccordion childrenCount={blocks.length} instruction={instruction} />
        )}

        {/* Processing or Completed view */}
        {isProcessing ? (
          <ProcessingView
            accumulatedUsage={accumulatedUsage}
            assistantId={assistantId}
            blocks={blocks}
            model={model}
            provider={provider}
            startTime={startTime}
            totalToolCalls={totalToolCalls}
          />
        ) : (
          <CompletedView
            assistantId={assistantId}
            blocks={blocks}
            duration={duration}
            model={model}
            provider={provider}
            totalCost={totalCost}
            totalTokens={accumulatedUsage.totalTokens}
            totalToolCalls={totalToolCalls}
          />
        )}
      </Flexbox>
    );
  },
);

TaskMessages.displayName = 'TaskMessages';

export default TaskMessages;
