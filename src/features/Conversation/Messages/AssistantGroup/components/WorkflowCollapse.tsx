import { LOADING_FLAT } from '@lobechat/const';
import { type ChatToolPayloadWithResult } from '@lobechat/types';
import { Accordion, AccordionItem, Block, Flexbox, Icon, Text } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { Check, Loader2, X } from 'lucide-react';
import { type Key, memo, useEffect, useMemo, useRef, useState } from 'react';

import { useAutoScroll } from '@/hooks/useAutoScroll';
import { shinyTextStyles } from '@/styles';
import { type AssistantContentBlock } from '@/types/index';

import { messageStateSelectors, useConversationStore } from '../../../store';
import { formatReasoningDuration, getWorkflowSummaryText, hasToolError } from '../toolDisplayNames';
import WorkflowExpandedList from './WorkflowExpandedList';

interface WorkflowCollapseProps {
  /** Assistant group message id (for generation state) */
  assistantMessageId: string;
  blocks: AssistantContentBlock[];
  disableEditing?: boolean;
  /** True when {@link Group} also renders blocks outside this collapse (answer / pre-tool phase) */
  hasBlocksOutsideWorkflow: boolean;
}

const collectTools = (blocks: AssistantContentBlock[]): ChatToolPayloadWithResult[] => {
  return blocks.flatMap((b) => b.tools ?? []);
};

const areAllToolsComplete = (tools: ChatToolPayloadWithResult[]): boolean => {
  const collapsible = tools.filter((t) => t.intervention?.status !== 'pending');
  if (collapsible.length === 0) return false;
  return collapsible.every((t) => t.result != null && t.result.content !== LOADING_FLAT);
};

const WorkflowCollapse = memo<WorkflowCollapseProps>(
  ({ assistantMessageId, blocks, disableEditing, hasBlocksOutsideWorkflow }) => {
    const allTools = useMemo(() => collectTools(blocks), [blocks]);
    const toolsPhaseComplete = areAllToolsComplete(allTools);
    const isGenerating = useConversationStore(
      messageStateSelectors.isMessageGenerating(assistantMessageId),
    );

    const allComplete = toolsPhaseComplete && !(isGenerating && !hasBlocksOutsideWorkflow);
    const summaryText = useMemo(() => getWorkflowSummaryText(blocks), [blocks]);
    const errorPresent = hasToolError(allTools);

    /** Sum of per-round model output duration (not reasoning-only); see ModelPerformance.duration */
    const totalWorkflowMs = useMemo(
      () => blocks.reduce((sum, b) => sum + (b.performance?.duration ?? 0), 0),
      [blocks],
    );
    const durationText = totalWorkflowMs > 0 ? formatReasoningDuration(totalWorkflowMs) : undefined;

    const [expanded, setExpanded] = useState(!allComplete);
    const [userExpanded, setUserExpanded] = useState(false);
    const prevCompleteRef = useRef(allComplete);
    const prevToolCountRef = useRef(allTools.length);

    useEffect(() => {
      if (allComplete && !prevCompleteRef.current && !userExpanded && allTools.length > 0) {
        setExpanded(false);
      }
      prevCompleteRef.current = allComplete;
    }, [allComplete, allTools.length, userExpanded]);

    useEffect(() => {
      if (allTools.length > prevToolCountRef.current) {
        setExpanded(true);
        setUserExpanded(false);
      }
      prevToolCountRef.current = allTools.length;
    }, [allTools.length]);

    const streaming = !allComplete;
    const isExpanded = streaming || expanded;

    const handleExpandedChange = (keys: Key[]) => {
      const nowExpanded = keys.includes('workflow');
      setExpanded(nowExpanded);
      if (nowExpanded) {
        setUserExpanded(true);
      }
    };
    const constrained = streaming && !userExpanded;

    const { ref: scrollRef, handleScroll: handleAutoScroll } = useAutoScroll<HTMLDivElement>({
      deps: [allTools.length],
      enabled: constrained,
      threshold: 120,
    });

    const statusIcon = streaming ? (
      <Icon spin color={cssVar.colorTextDescription} icon={Loader2} />
    ) : errorPresent ? (
      <Icon color={cssVar.colorError} icon={X} />
    ) : (
      <Icon color={cssVar.colorSuccess} icon={Check} />
    );

    const title = (
      <Flexbox horizontal align="center" gap={6}>
        <Block
          horizontal
          align="center"
          flex="none"
          height={24}
          justify="center"
          style={{ fontSize: 12 }}
          variant="outlined"
          width={24}
        >
          {statusIcon}
        </Block>
        {streaming ? (
          <span className={shinyTextStyles.shinyText}>Working...</span>
        ) : (
          <Flexbox horizontal align="center" gap={6} style={{ minWidth: 0, overflow: 'hidden' }}>
            <Text
              style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
              type="secondary"
            >
              {summaryText}
            </Text>
            {durationText && (
              <span style={{ color: cssVar.colorTextQuaternary, flexShrink: 0 }}>
                {durationText}
              </span>
            )}
          </Flexbox>
        )}
      </Flexbox>
    );

    return (
      <Accordion
        expandedKeys={isExpanded ? ['workflow'] : []}
        hideIndicator={streaming}
        indicatorPlacement="end"
        variant="borderless"
        onExpandedChange={handleExpandedChange}
      >
        <AccordionItem itemKey="workflow" paddingBlock={4} paddingInline={4} title={title}>
          <WorkflowExpandedList
            blocks={blocks}
            constrained={constrained}
            disableEditing={disableEditing}
            scrollRef={scrollRef}
            onScroll={handleAutoScroll}
          />
        </AccordionItem>
      </Accordion>
    );
  },
);

WorkflowCollapse.displayName = 'WorkflowCollapse';

export default WorkflowCollapse;
