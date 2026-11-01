import type { ReactNode } from 'react';

import CouncilList from '../../AgentCouncil/components/CouncilList';
import type { GroupChainView } from './groupChain';
import {
  hasPendingIntervention,
  hasRenderedContentAfter,
  isEmptyBlock,
  shouldInlineWorkflowSegment,
  withMarkdownStreamingState,
} from './groupChain';
import GroupItem from './GroupItem';
import type { GroupRenderSegment } from './segments';
import WorkflowCollapse, { type WorkflowExpandLevelDefault } from './WorkflowCollapse';

export interface ChainSegmentRenderOptions {
  defaultWorkflowExpandLevel?: WorkflowExpandLevelDefault;
  disableEditing?: boolean;
  enableProcessFold?: boolean;
  messageIndex: number;
}

export const renderChainSegment = (
  view: GroupChainView,
  segment: GroupRenderSegment,
  options: ChainSegmentRenderOptions,
): ReactNode => {
  const { contentId, id, isGenerating, lastBlockId, segments } = view;
  const { defaultWorkflowExpandLevel, disableEditing, enableProcessFold, messageIndex } = options;
  const index = segments.indexOf(segment);

  if (segment.kind === 'workflow') {
    if (segment.blocks.length === 0) return null;

    if (segment.standalone || shouldInlineWorkflowSegment(segment.blocks)) {
      return segment.blocks.map((block, blockIndex) => {
        const item = withMarkdownStreamingState(block, lastBlockId);
        if (!isGenerating && isEmptyBlock(item)) return null;

        return (
          <GroupItem
            {...item}
            assistantId={id}
            contentId={contentId}
            disableEditing={disableEditing}
            key={item.renderKey ?? `${id}.workflow-inline.${index}.${blockIndex}`}
            messageIndex={messageIndex}
          />
        );
      });
    }

    return (
      <WorkflowCollapse
        assistantMessageId={id}
        blocks={segment.blocks.map((block) => withMarkdownStreamingState(block, lastBlockId))}
        defaultWorkflowExpandLevel={defaultWorkflowExpandLevel}
        disableEditing={disableEditing}
        key={segment.blocks[0]?.renderKey ?? `${id}.workflow.${index}`}
        // While the turn's operation is still running, process folding may
        // take over the moment it ends: the segment tree re-parents into
        // ProcessFold, which remounts WorkflowCollapse already collapsed —
        // one non-animated reflow. Letting the collapse also self-animate
        // from semi → collapsed first would shrink the layout twice and make
        // the conversation jitter. Once the op ends without a fold happening
        // (tool-only turn, no final answer), suppression releases and
        // WorkflowCollapse applies its completion level then.
        suppressAutoCollapse={!!enableProcessFold && view.hasActiveOperation}
        workflowChromeComplete={
          view.workflowChromeComplete ||
          (hasRenderedContentAfter(segments, index) && !hasPendingIntervention(segment.blocks))
        }
      />
    );
  }

  const item = segment.block;

  // AgentCouncil block: broadcast members rendered as parallel columns inside
  // the supervisor's bubble.
  if (item.council && item.council.length > 0) {
    return (
      <CouncilList
        activeTab={0}
        displayMode={'horizontal'}
        key={item.renderKey ?? `${id}.${item.id}.${index}`}
        members={item.council}
      />
    );
  }

  if (!isGenerating && isEmptyBlock(item)) return null;

  return (
    <GroupItem
      {...withMarkdownStreamingState(item, lastBlockId)}
      assistantId={id}
      contentId={contentId}
      disableEditing={disableEditing}
      key={item.renderKey ?? `${id}.${item.id}.${index}`}
      messageIndex={messageIndex}
    />
  );
};
