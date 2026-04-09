import { LOADING_FLAT } from '@lobechat/const';
import { type ChatToolPayloadWithResult } from '@lobechat/types';
import { AccordionItem, Block, Flexbox, Icon, Text } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { Check, Loader2, X } from 'lucide-react';
import { memo, useEffect, useMemo, useRef, useState } from 'react';

import { shinyTextStyles } from '@/styles';
import { type AssistantContentBlock } from '@/types/index';

import { formatReasoningDuration, getWorkflowSummaryText, hasToolError } from '../toolDisplayNames';
import WorkflowExpandedList from './WorkflowExpandedList';

interface WorkflowCollapseProps {
  assistantId: string;
  blocks: AssistantContentBlock[];
  disableEditing?: boolean;
}

const collectTools = (blocks: AssistantContentBlock[]): ChatToolPayloadWithResult[] => {
  return blocks.flatMap((b) => b.tools ?? []);
};

const areAllToolsComplete = (tools: ChatToolPayloadWithResult[]): boolean => {
  const collapsible = tools.filter((t) => t.intervention?.status !== 'pending');
  if (collapsible.length === 0) return false;
  return collapsible.every((t) => t.result != null && t.result.content !== LOADING_FLAT);
};

const WorkflowCollapse = memo<WorkflowCollapseProps>(({ blocks, assistantId, disableEditing }) => {
  const allTools = useMemo(() => collectTools(blocks), [blocks]);
  const allComplete = areAllToolsComplete(allTools);
  const summaryText = useMemo(() => getWorkflowSummaryText(blocks), [blocks]);
  const errorPresent = hasToolError(allTools);

  const totalReasoningMs = useMemo(
    () => blocks.reduce((sum, b) => sum + (b.reasoning?.duration ?? 0), 0),
    [blocks],
  );
  const durationText = totalReasoningMs > 0 ? formatReasoningDuration(totalReasoningMs) : undefined;

  const [expanded, setExpanded] = useState(!allComplete);
  const userExpandedRef = useRef(false);
  const prevCompleteRef = useRef(allComplete);
  const prevToolCountRef = useRef(allTools.length);

  useEffect(() => {
    if (
      allComplete &&
      !prevCompleteRef.current &&
      !userExpandedRef.current &&
      allTools.length > 0
    ) {
      setExpanded(false);
    }
    prevCompleteRef.current = allComplete;
  }, [allComplete, allTools.length]);

  useEffect(() => {
    if (allTools.length > prevToolCountRef.current) {
      setExpanded(true);
      userExpandedRef.current = false;
    }
    prevToolCountRef.current = allTools.length;
  }, [allTools.length]);

  const handleExpandChange = (isExpanded: boolean) => {
    setExpanded(isExpanded);
    if (isExpanded) {
      userExpandedRef.current = true;
    }
  };

  const streaming = !allComplete;

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
            <span style={{ color: cssVar.colorTextQuaternary, flexShrink: 0 }}>{durationText}</span>
          )}
        </Flexbox>
      )}
    </Flexbox>
  );

  return (
    <div>
      <AccordionItem
        expand={streaming ? true : expanded}
        hideIndicator={streaming}
        indicatorPlacement="end"
        itemKey="workflow"
        paddingBlock={4}
        paddingInline={4}
        title={title}
        variant="borderless"
        onExpandChange={handleExpandChange}
      >
        <WorkflowExpandedList
          assistantId={assistantId}
          blocks={blocks}
          disableEditing={disableEditing}
        />
      </AccordionItem>
    </div>
  );
});

WorkflowCollapse.displayName = 'WorkflowCollapse';

export default WorkflowCollapse;
