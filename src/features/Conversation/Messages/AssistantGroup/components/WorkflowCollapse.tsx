import { LOADING_FLAT } from '@lobechat/const';
import { type ChatToolPayloadWithResult } from '@lobechat/types';
import { createStaticStyles } from 'antd-style';
import { AnimatePresence, m as motion } from 'motion/react';
import { memo, useEffect, useMemo, useRef, useState } from 'react';

import { type AssistantContentBlock } from '@/types/index';

import { formatReasoningDuration, getWorkflowSummaryText, hasToolError } from '../toolDisplayNames';
import WorkflowExpandedList from './WorkflowExpandedList';
import WorkflowSummary from './WorkflowSummary';

const styles = createStaticStyles(({ css }) => ({
  root: css`
    @keyframes workflow-pulse {
      0%,
      100% {
        opacity: 1;
      }

      50% {
        opacity: 0.35;
      }
    }

    @keyframes spin {
      from {
        transform: rotate(0deg);
      }

      to {
        transform: rotate(360deg);
      }
    }
  `,
}));

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

  const [collapsed, setCollapsed] = useState(allComplete);
  const userExpandedRef = useRef(false);
  const prevCompleteRef = useRef(allComplete);
  const prevToolCountRef = useRef(allTools.length);

  useEffect(() => {
    // Only auto-collapse on transition: incomplete → complete
    if (
      allComplete &&
      !prevCompleteRef.current &&
      !userExpandedRef.current &&
      allTools.length > 0
    ) {
      setCollapsed(true);
    }
    prevCompleteRef.current = allComplete;
  }, [allComplete, allTools.length]);

  useEffect(() => {
    if (allTools.length > prevToolCountRef.current) {
      setCollapsed(false);
      userExpandedRef.current = false;
    }
    prevToolCountRef.current = allTools.length;
  }, [allTools.length]);

  const handleToggle = () => {
    if (collapsed) {
      setCollapsed(false);
      userExpandedRef.current = true;
    } else {
      setCollapsed(true);
    }
  };

  const listProps = {
    assistantId,
    blocks,
    disableEditing,
  };

  return (
    <div className={styles.root}>
      <WorkflowSummary
        duration={durationText}
        expanded={!collapsed}
        hasError={errorPresent}
        streaming={!allComplete}
        summaryText={summaryText}
        onToggle={handleToggle}
      />
      <AnimatePresence initial={false}>
        {(!allComplete || !collapsed) && (
          <motion.div
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            initial={allComplete ? { height: 0, opacity: 0 } : false}
            key="workflow-list"
            style={{ overflow: 'hidden' }}
            transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
          >
            <WorkflowExpandedList {...listProps} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});

WorkflowCollapse.displayName = 'WorkflowCollapse';

export default WorkflowCollapse;
