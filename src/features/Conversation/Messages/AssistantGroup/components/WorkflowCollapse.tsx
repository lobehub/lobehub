import { type ChatToolPayloadWithResult } from '@lobechat/types';
import { Accordion, AccordionItem, Block, Flexbox, Icon, Text } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { Check, HandIcon, X } from 'lucide-react';
import { AnimatePresence, m as motion } from 'motion/react';
import { type Key, memo, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import NeuralNetworkLoading from '@/components/NeuralNetworkLoading';
import { useAutoScroll } from '@/hooks/useAutoScroll';
import { shinyTextStyles } from '@/styles';
import { type AssistantContentBlock } from '@/types/index';

import { messageStateSelectors, useConversationStore } from '../../../store';
import {
  TIME_MS_PER_SECOND,
  WORKFLOW_EXPANDED_SCROLL_THRESHOLD_PX,
  WORKFLOW_HEADLINE_DEBOUNCE_MS,
  WORKFLOW_PROSE_IDLE_COMMIT_MS,
  WORKFLOW_PROSE_QUICK_COMMIT_MS,
  WORKFLOW_STREAMING_TITLE_MIN_HEIGHT_PX,
  WORKFLOW_WORKING_ELAPSED_SHOW_AFTER_MS,
} from '../constants';
import {
  areWorkflowToolsComplete,
  formatReasoningDuration,
  getWorkflowStreamingHeadlineState,
  getWorkflowSummaryText,
  hasToolError,
  shapeProseForWorkflowHeadline,
} from '../toolDisplayNames';
import WorkflowExpandedList from './WorkflowExpandedList';

interface WorkflowCollapseProps {
  /** Assistant group message id (for generation state) */
  assistantMessageId: string;
  blocks: AssistantContentBlock[];
  /** Default expansion state while the workflow is still streaming. Pending intervention always expands. */
  defaultStreamingExpanded?: boolean;
  disableEditing?: boolean;
  workflowChromeComplete?: boolean;
}

const collectTools = (blocks: AssistantContentBlock[]): ChatToolPayloadWithResult[] => {
  return blocks.flatMap((b) => b.tools ?? []);
};

const hasPendingIntervention = (tools: ChatToolPayloadWithResult[]) => {
  return tools.some((tool) => tool.intervention?.status === 'pending');
};

const useDebouncedHeadline = (raw: string, allComplete: boolean, immediate = false) => {
  const [out, setOut] = useState(raw);
  const prevCompleteRef = useRef(allComplete);

  useEffect(() => {
    const wasComplete = prevCompleteRef.current;
    prevCompleteRef.current = allComplete;
    const streaming = !allComplete;

    if (immediate) {
      setOut(raw);
      return;
    }
    if (!streaming) {
      setOut(raw);
      return;
    }
    if (wasComplete) {
      setOut(raw);
      return;
    }
    const id = window.setTimeout(() => setOut(raw), WORKFLOW_HEADLINE_DEBOUNCE_MS);
    return () => window.clearTimeout(id);
  }, [allComplete, immediate, raw]);

  return !allComplete ? out : raw;
};

const useCommittedProseHeadline = (proseSource: string, streaming: boolean) => {
  const [committed, setCommitted] = useState('');

  useEffect(() => {
    if (!streaming) {
      setCommitted('');
      return;
    }
    if (!proseSource.trim()) {
      setCommitted('');
      return;
    }
    const shaped = shapeProseForWorkflowHeadline(proseSource);
    if (!shaped) {
      setCommitted('');
      return;
    }
    const quick = /[。！？.!?]\s*$/.test(shaped);
    const delay = quick ? WORKFLOW_PROSE_QUICK_COMMIT_MS : WORKFLOW_PROSE_IDLE_COMMIT_MS;
    const id = window.setTimeout(() => setCommitted(shaped), delay);
    return () => window.clearTimeout(id);
  }, [proseSource, streaming]);

  return committed;
};

const WorkflowCollapse = memo<WorkflowCollapseProps>(
  ({
    assistantMessageId,
    blocks,
    defaultStreamingExpanded = true,
    disableEditing,
    workflowChromeComplete = false,
  }) => {
    const { t } = useTranslation('chat');
    const allTools = useMemo(() => collectTools(blocks), [blocks]);
    const toolsPhaseComplete = areWorkflowToolsComplete(allTools);
    const pendingInterventionPresent = useMemo(() => hasPendingIntervention(allTools), [allTools]);
    const isGenerating = useConversationStore(
      messageStateSelectors.isMessageGenerating(assistantMessageId),
    );

    const allComplete = toolsPhaseComplete && (workflowChromeComplete || !isGenerating);
    const summaryText = useMemo(() => getWorkflowSummaryText(blocks), [blocks]);
    const errorPresent = hasToolError(allTools);

    /** Sum of per-round model output duration (not reasoning-only); see ModelPerformance.duration */
    const totalWorkflowMs = useMemo(
      () => blocks.reduce((sum, b) => sum + (b.performance?.duration ?? 0), 0),
      [blocks],
    );
    const durationText = totalWorkflowMs > 0 ? formatReasoningDuration(totalWorkflowMs) : undefined;
    const streamingDefaultExpanded = defaultStreamingExpanded || pendingInterventionPresent;

    const [expanded, setExpanded] = useState(() => !allComplete && streamingDefaultExpanded);
    const userOpenedRef = useRef(false);
    const prevCompleteRef = useRef(allComplete);

    useEffect(() => {
      const wasComplete = prevCompleteRef.current;
      prevCompleteRef.current = allComplete;

      if (!allComplete && wasComplete) {
        userOpenedRef.current = false;
        setExpanded(streamingDefaultExpanded);
        return;
      }

      if (allComplete && !wasComplete && !userOpenedRef.current && allTools.length > 0) {
        setExpanded(false);
      }
    }, [allComplete, allTools.length, streamingDefaultExpanded]);

    const streaming = !allComplete;
    const forceExpanded = streaming && pendingInterventionPresent;
    const isExpanded = forceExpanded || expanded;

    useEffect(() => {
      if (streaming && pendingInterventionPresent) {
        setExpanded(true);
      }
    }, [pendingInterventionPresent, streaming]);

    const headlineState = useMemo(() => getWorkflowStreamingHeadlineState(blocks), [blocks]);
    const committedProse = useCommittedProseHeadline(
      headlineState.kind === 'prose' ? headlineState.proseSource : '',
      streaming,
    );

    const showExpandedWorkingLabel = streaming && isExpanded && !pendingInterventionPresent;
    const pendingInterventionLabel = t('workflow.awaitingConfirmation', {
      defaultValue: 'Awaiting your confirmation',
    });
    const workingLabel = t('workflow.working', { defaultValue: 'Working...' });
    const streamingHeadlineRaw = useMemo(() => {
      if (pendingInterventionPresent) return pendingInterventionLabel;
      if (showExpandedWorkingLabel) return workingLabel;
      switch (headlineState.kind) {
        case 'thinking': {
          return headlineState.reasoningTitle;
        }
        case 'tool': {
          return headlineState.explicitStep || headlineState.fallbackTool;
        }
        case 'prose': {
          return committedProse;
        }
        default: {
          return '';
        }
      }
    }, [
      committedProse,
      headlineState,
      pendingInterventionLabel,
      pendingInterventionPresent,
      showExpandedWorkingLabel,
      workingLabel,
    ]);
    const streamingHeadline = useDebouncedHeadline(
      streamingHeadlineRaw,
      allComplete,
      showExpandedWorkingLabel || pendingInterventionPresent,
    );

    const [workingElapsedSeconds, setWorkingElapsedSeconds] = useState(0);
    const accumulatedWorkingMsRef = useRef(0);
    const activeWorkingStartedAtRef = useRef<number | null>(null);

    useEffect(() => {
      if (!streaming) {
        accumulatedWorkingMsRef.current = 0;
        activeWorkingStartedAtRef.current = null;
        setWorkingElapsedSeconds(0);
        return;
      }

      if (pendingInterventionPresent) {
        if (activeWorkingStartedAtRef.current !== null) {
          accumulatedWorkingMsRef.current += Date.now() - activeWorkingStartedAtRef.current;
          activeWorkingStartedAtRef.current = null;
        }
        setWorkingElapsedSeconds(Math.floor(accumulatedWorkingMsRef.current / TIME_MS_PER_SECOND));
        return;
      }

      if (activeWorkingStartedAtRef.current === null) {
        activeWorkingStartedAtRef.current = Date.now();
      }

      const tick = () => {
        const activeMs =
          activeWorkingStartedAtRef.current === null
            ? 0
            : Date.now() - activeWorkingStartedAtRef.current;
        const totalMs = accumulatedWorkingMsRef.current + activeMs;
        setWorkingElapsedSeconds(Math.floor(totalMs / TIME_MS_PER_SECOND));
      };

      tick();
      const interval = setInterval(tick, 1000);

      return () => clearInterval(interval);
    }, [pendingInterventionPresent, streaming]);

    const showWorkingElapsed =
      !pendingInterventionPresent &&
      workingElapsedSeconds >= WORKFLOW_WORKING_ELAPSED_SHOW_AFTER_MS / TIME_MS_PER_SECOND;

    const handleExpandedChange = (keys: Key[]) => {
      const nowExpanded = keys.includes('workflow');
      if (forceExpanded && !nowExpanded) return;

      setExpanded(nowExpanded);
      if (nowExpanded) userOpenedRef.current = true;
    };
    const constrained = streaming && isExpanded;

    const { ref: scrollRef, handleScroll: handleAutoScroll } = useAutoScroll<HTMLDivElement>({
      deps: [allTools.length],
      enabled: constrained,
      threshold: WORKFLOW_EXPANDED_SCROLL_THRESHOLD_PX,
    });

    const statusIcon = streaming ? (
      pendingInterventionPresent ? (
        <Icon color={cssVar.colorInfo} icon={HandIcon} />
      ) : (
        <NeuralNetworkLoading size={16} />
      )
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
          <Flexbox
            horizontal
            align="center"
            flex={1}
            gap={6}
            style={{ minHeight: WORKFLOW_STREAMING_TITLE_MIN_HEIGHT_PX, minWidth: 0 }}
          >
            <div style={{ minWidth: 0, overflow: 'hidden' }}>
              <AnimatePresence initial={false} mode="wait">
                <motion.div
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  initial={{ opacity: 0, y: 8 }}
                  key={streamingHeadline || 'working-fallback'}
                  transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    minHeight: WORKFLOW_STREAMING_TITLE_MIN_HEIGHT_PX,
                  }}
                >
                  <span
                    className={pendingInterventionPresent ? undefined : shinyTextStyles.shinyText}
                    style={{
                      color: pendingInterventionPresent ? cssVar.colorInfo : undefined,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {streamingHeadline ||
                      (pendingInterventionPresent ? pendingInterventionLabel : workingLabel)}
                  </span>
                </motion.div>
              </AnimatePresence>
            </div>
            {showWorkingElapsed && (
              <span style={{ color: cssVar.colorTextQuaternary, flexShrink: 0 }}>
                ({workingElapsedSeconds}s)
              </span>
            )}
          </Flexbox>
        ) : (
          <Flexbox horizontal align="center" gap={6} style={{ minWidth: 0, overflow: 'hidden' }}>
            <Text
              type="secondary"
              style={{
                minWidth: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
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
        variant="borderless"
        onExpandedChange={handleExpandedChange}
      >
        <AccordionItem itemKey="workflow" paddingBlock={4} paddingInline={4} title={title}>
          <WorkflowExpandedList
            assistantId={assistantMessageId}
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
