import { splitAssistantGroupFinalAnswer } from '@lobechat/conversation-flow';
import { Flexbox } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import isEqual from 'fast-deep-equal';
import { memo, useMemo } from 'react';

import ContentLoading from '@/features/Conversation/Messages/components/ContentLoading';
import { useChatStore } from '@/store/chat';
import { operationSelectors } from '@/store/chat/slices/operation/selectors';
import type { OperationStatus } from '@/store/chat/slices/operation/types';
import type { AssistantContentBlock } from '@/types/index';

import { messageStateSelectors, useConversationStore } from '../../../store';
import { MessageAggregationContext } from '../../Contexts/MessageAggregationContext';
import { formatReasoningDuration } from '../toolDisplayNames';
import { CollapsedMessage } from './CollapsedMessage';
import type { GroupChainInput, GroupChainView } from './groupChain';
import { buildChainView, getLastBlockCreatedAt, getTurnDurationMs } from './groupChain';
import ProcessFold from './ProcessFold';
import { renderChainSegment } from './renderChainSegment';
import type { GroupRenderSegment } from './segments';
import { countAssistantLlmCalls, hasRenderableFinalAnswer, shouldFoldProcess } from './segments';
import SteerMessage from './SteerMessage';
import type { WorkflowExpandLevelDefault } from './WorkflowCollapse';

const styles = createStaticStyles(({ css }) => {
  return {
    container: css`
      &:has(.tool-blocks) {
        width: 100%;
      }
    `,
  };
});

const ACTIVE_OPERATION_STATUSES = new Set<OperationStatus>(['pending', 'paused', 'running']);

interface GroupChildrenProps {
  blocks: AssistantContentBlock[];
  content?: string;
  contentId?: string;
  /** Later turns steered onto this one; each renders as a continuation of the same chain. */
  continuations?: GroupChainInput[];
  defaultWorkflowExpandLevel?: WorkflowExpandLevelDefault;
  disableEditing?: boolean;
  /** Lab flag: fold finished non-latest turns' process under a "已处理" header. */
  enableProcessFold?: boolean;
  id: string;
  /** Render each continuation's steer message inside the chain (streaming); otherwise the list hoists them above. */
  inlineSteer?: boolean;
  /** Whether this turn is the latest item in the conversation. */
  isLatestItem?: boolean;
  messageIndex: number;
}

const Group = memo<GroupChildrenProps>(
  ({
    blocks,
    contentId,
    continuations,
    defaultWorkflowExpandLevel,
    disableEditing,
    messageIndex,
    id,
    content,
    inlineSteer,
    isLatestItem,
    enableProcessFold,
  }) => {
    const chains = useMemo<GroupChainInput[]>(
      () => [{ blocks, contentId, id }, ...(continuations ?? [])],
      [blocks, contentId, continuations, id],
    );
    const [isCollapsed, generatingFlags] = useConversationStore(
      (s) => [
        messageStateSelectors.isMessageCollapsed(id)(s),
        chains.map((chain) => messageStateSelectors.isAssistantGroupItemGenerating(chain.id)(s)),
      ],
      isEqual,
    );
    // A running op whose visible output already ended (`visible_output_end` →
    // `metadata.visibleLoadingDone`) only has terminal bookkeeping left
    // (server-side persistence, agent_runtime_end, completeRun). Treating it as
    // still active would delay process folding by seconds after the answer
    // finished streaming. Safe to fold early: `stream_start` resets the flag,
    // so a follow-up step re-activates the operation.
    const activeFlags = useChatStore(
      (s) =>
        chains.map((chain) =>
          operationSelectors
            .getOperationsByMessage(chain.id)(s)
            .some(
              (op) =>
                ACTIVE_OPERATION_STATUSES.has(op.status) &&
                !(op.status === 'running' && op.metadata.visibleLoadingDone),
            ),
        ),
      isEqual,
    );
    const allBlocks = useMemo(() => chains.flatMap((chain) => chain.blocks), [chains]);
    const turnDurationMs = useConversationStore((s) => getTurnDurationMs(s.dbMessages, allBlocks));
    const lastBlock = allBlocks.at(-1);
    const lastBlockCreatedAt = useConversationStore((s) =>
      getLastBlockCreatedAt(s.dbMessages, lastBlock),
    );
    const contextValues = useMemo(
      () => chains.map((chain) => ({ assistantGroupId: chain.id })),
      [chains],
    );

    const views = useMemo(
      () =>
        chains.map((chain, index) =>
          buildChainView(chain, {
            hasActiveOperation: !!activeFlags[index],
            isGenerating: !!generatingFlags[index],
          }),
        ),
      [activeFlags, chains, generatingFlags],
    );
    const lastView = views.at(-1)!;
    const isGenerating = lastView.isGenerating;

    if (isCollapsed) {
      return (
        content && (
          <Flexbox>
            <CollapsedMessage content={content} id={id} />
          </Flexbox>
        )
      );
    }

    const renderOptions = {
      defaultWorkflowExpandLevel,
      disableEditing,
      enableProcessFold,
      messageIndex,
    };

    const renderChain = (
      view: GroupChainView,
      segments: GroupRenderSegment[],
      options?: { withSteer?: boolean },
    ) => {
      const chainIndex = views.indexOf(view);
      return (
        <MessageAggregationContext
          key={`${view.id}.${options?.withSteer ? 'process' : 'final'}`}
          value={contextValues[chainIndex]!}
        >
          {options?.withSteer && inlineSteer && view.steerUserId && (
            <SteerMessage id={view.steerUserId} />
          )}
          {segments.map((segment) => renderChainSegment(view, segment, renderOptions))}
        </MessageAggregationContext>
      );
    };

    // Codex-style turn folding: once the turn's op has ended, fold its whole
    // process (reasoning + tools + intermediate prose) under a single "已处理
    // {duration}" header, leaving the final answer always visible — for every
    // turn, latest or not. Folding must never swallow the final answer, since
    // that is the turn's payload; only the process collapses. The latest turn
    // is eligible only once its final answer exists (so a tool-only latest turn
    // does not collapse into a lone header); still-generating turns render in
    // full. Steered continuations fold as one chain: every earlier turn's
    // output is process, only the last turn's final answer stays visible.
    const { processSegments, finalSegments } = splitAssistantGroupFinalAnswer(lastView.segments);
    const earlierViews = views.slice(0, -1);
    const llmCallCount = views.reduce(
      (sum, view) => sum + countAssistantLlmCalls(view.segments),
      0,
    );
    const foldProcess = shouldFoldProcess({
      enabled: enableProcessFold,
      hasFinalAnswer: hasRenderableFinalAnswer(finalSegments),
      isGenerating,
      isLatestItem,
      operationEnded: !views.some((view) => view.hasActiveOperation),
      processSegments: [...earlierViews.flatMap((view) => view.segments), ...processSegments],
    });

    const durationText =
      turnDurationMs >= 1000 ? formatReasoningDuration(turnDurationMs) : undefined;

    return (
      <Flexbox className={styles.container} gap={4}>
        {foldProcess ? (
          <>
            <ProcessFold durationText={durationText} stepCount={llmCallCount}>
              <Flexbox gap={8}>
                {earlierViews.map((view) => renderChain(view, view.segments, { withSteer: true }))}
                {renderChain(lastView, processSegments, { withSteer: true })}
              </Flexbox>
            </ProcessFold>
            {renderChain(lastView, finalSegments)}
          </>
        ) : (
          <>
            {views.map((view) => renderChain(view, view.segments, { withSteer: true }))}
            {lastView.showTailRunningIndicator && (
              <ContentLoading id={lastView.id} startTime={lastBlockCreatedAt} />
            )}
          </>
        )}
      </Flexbox>
    );
  },
  isEqual,
);

export default Group;
