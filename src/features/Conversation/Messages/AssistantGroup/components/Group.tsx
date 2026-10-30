import { splitAssistantGroupFinalAnswer } from '@lobechat/conversation-flow';
import { createStaticStyles, Flexbox } from '@lobehub/ui';
import isEqual from 'fast-deep-equal';
import { Fragment, memo, useMemo } from 'react';

import ContentLoading from '@/features/Conversation/Messages/components/ContentLoading';
import { useChatStore } from '@/store/chat';
import { operationSelectors } from '@/store/chat/slices/operation/selectors';
import type { OperationStatus } from '@/store/chat/slices/operation/types';
import { serverConfigSelectors, useServerConfigStore } from '@/store/serverConfig';
import type { AssistantContentBlock } from '@/types/index';

import { messageStateSelectors, useConversationStore } from '../../../store';
import { MessageAggregationContext } from '../../Contexts/MessageAggregationContext';
import { formatReasoningDuration } from '../toolDisplayNames';
import { CollapsedMessage } from './CollapsedMessage';
import type { GroupChainInput, GroupChainView } from './groupChain';
import { buildChainView, getChainDurationsMs, getLastBlockCreatedAt } from './groupChain';
import ProcessFold from './ProcessFold';
import { getChainSegmentKey, renderChainSegment } from './renderChainSegment';
import type { GroupRenderSegment } from './segments';
import {
  countAssistantLlmCalls,
  hasRenderableFinalAnswer,
  liftMcpAppSegments,
  shouldFoldProcess,
} from './segments';
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
        chains.map(
          (chain) =>
            messageStateSelectors.isAssistantGroupItemGenerating(chain.id)(s) ||
            messageStateSelectors.isMessageCreating(chain.id)(s),
        ),
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
    const blockIds = useMemo(() => new Set(allBlocks.map((block) => block.id)), [allBlocks]);
    /** A stale group projection must receive persisted finish types before empty-block filtering. */
    const persistedFinishTypes = useConversationStore((s) => {
      const result: Record<string, string> = {};
      for (const message of s.dbMessages) {
        const finishType = message.metadata?.finishType;
        if (blockIds.has(message.id) && typeof finishType === 'string') {
          result[message.id] = finishType;
        }
      }
      return result;
    }, isEqual);
    const chainsWithFinishTypes = useMemo(
      () =>
        chains.map((chain) => ({
          ...chain,
          blocks: chain.blocks.map((block) => {
            if (block.metadata?.finishType != null) return block;
            const finishType = persistedFinishTypes[block.id];
            return finishType ? { ...block, metadata: { ...block.metadata, finishType } } : block;
          }),
        })),
      [chains, persistedFinishTypes],
    );
    const chainDurations = useConversationStore(
      (s) => getChainDurationsMs(s.dbMessages, chains),
      isEqual,
    );
    const lastBlock = allBlocks.at(-1);
    const lastBlockCreatedAt = useConversationStore((s) =>
      getLastBlockCreatedAt(s.dbMessages, lastBlock),
    );
    const contextValues = useMemo(
      () => chains.map((chain) => ({ assistantGroupId: chain.id })),
      [chains],
    );
    // Off: no view is lifted or broken out, and the turn renders as it did
    // before MCP Apps.
    const enableMcpApp = useServerConfigStore(serverConfigSelectors.enableMcpApp);

    const views = useMemo(
      () =>
        chainsWithFinishTypes.map((chain, index) =>
          buildChainView(chain, {
            enableMcpApp,
            hasActiveOperation: !!activeFlags[index],
            isGenerating: !!generatingFlags[index],
          }),
        ),
      [activeFlags, chainsWithFinishTypes, enableMcpApp, generatingFlags],
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
      variant: 'process' | 'folded' | 'final',
    ) => (
      <MessageAggregationContext
        key={`${view.id}.${variant}`}
        value={contextValues[views.indexOf(view)]!}
      >
        {/* Keyed by the segment's place in the whole turn, not in this slice:
            folding changes the slice, and a positional key would remount a
            lifted view that stays on screen. The key does not depend on the
            mcp_app flag, so flags arriving after the first paint don't remount
            every segment. */}
        {segments.map((segment) => (
          <Fragment key={getChainSegmentKey(view, segment)}>
            {renderChainSegment(view, segment, renderOptions)}
          </Fragment>
        ))}
      </MessageAggregationContext>
    );

    // Codex-style turn folding: once the turn's op has ended, fold its whole
    // process (reasoning + tools + intermediate prose) under a single "已处理
    // {duration}" header, leaving the final answer always visible — for every
    // turn, latest or not. Folding must never swallow the final answer, since
    // that is the turn's payload; only the process collapses. The latest turn
    // is eligible only once its final answer exists (so a tool-only latest turn
    // does not collapse into a lone header); still-generating turns render in
    // full. Steered continuations fold per turn, and each turn keeps its own
    // final answer: a queued follow-up is only sent once the turn before it has
    // finished, so that turn's answer is a real reply, not process. Each steer
    // bubble sits after the answer of the turn it followed. A turn that stopped
    // on a tool call has no final answer and folds whole. MCP App views are
    // lifted out of the fold and sit between it and the answer. They stay in
    // the `process` chain in both states, so folding does not remount (and
    // reload) a view the user may already be using.
    const splits = views.map((view) => {
      const split = splitAssistantGroupFinalAnswer(view.segments);
      const { folded, lifted } = enableMcpApp
        ? liftMcpAppSegments(split.processSegments)
        : { folded: split.processSegments, lifted: [] };

      return { ...split, liftedSegments: lifted, processSegments: folded };
    });
    const finalSegments = splits.at(-1)!.finalSegments;
    const foldProcess = shouldFoldProcess({
      enabled: enableProcessFold,
      hasFinalAnswer: hasRenderableFinalAnswer(finalSegments),
      isGenerating,
      isLatestItem,
      operationEnded: !views.some((view) => view.hasActiveOperation),
      processSegments: splits.flatMap((split) => [
        ...split.processSegments,
        ...split.liftedSegments,
      ]),
    });

    const renderFold = (view: GroupChainView, index: number) => {
      const segments = splits[index]!.processSegments;
      if (segments.length === 0) return null;
      // Only intermediate prose is left once the views are lifted: nothing to fold.
      if (
        splits[index]!.liftedSegments.length > 0 &&
        !segments.some((segment) => segment.kind === 'workflow')
      ) {
        return renderChain(view, segments, 'folded');
      }
      const durationMs = chainDurations[index] ?? 0;
      return (
        <ProcessFold
          durationText={durationMs >= 1000 ? formatReasoningDuration(durationMs) : undefined}
          key={view.id}
          stepCount={countAssistantLlmCalls(view.segments)}
        >
          <Flexbox gap={8}>{renderChain(view, segments, 'folded')}</Flexbox>
        </ProcessFold>
      );
    };

    return (
      <Flexbox className={styles.container} gap={4}>
        {views.map((view, index) => (
          <Fragment key={view.id}>
            {view.steerUserId && <SteerMessage id={view.steerUserId} />}
            {foldProcess && renderFold(view, index)}
            {renderChain(
              view,
              foldProcess ? splits[index]!.liftedSegments : view.segments,
              'process',
            )}
            {foldProcess && renderChain(view, splits[index]!.finalSegments, 'final')}
          </Fragment>
        ))}
        {!foldProcess && lastView.showTailRunningIndicator && (
          <ContentLoading id={lastView.id} startTime={lastBlockCreatedAt} />
        )}
      </Flexbox>
    );
  },
  isEqual,
);

export default Group;
