'use client';

import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import { useSubTopicTree } from './context';
import SubTopicItem from './SubTopicItem';

/** Indent of nested sub-topic rows: one level, under the opener's title. */
const SUB_TOPIC_INDENT = 20;

/** An unfolded opener's sub-topics. Renders nothing while folded or off. */
const SubTopicChildren = memo<{ openerAgentId?: string; topicId: string }>(
  ({ openerAgentId, topicId }) => {
    const tree = useSubTopicTree();
    if (!tree || !tree.isExpanded(topicId)) return null;
    const nodes = tree.childrenOf(topicId);
    if (nodes.length === 0) return null;

    return (
      <Flexbox
        data-testid="sub-topic-children"
        gap={1}
        style={{ paddingInlineStart: SUB_TOPIC_INDENT }}
      >
        {nodes.map((node) => (
          <SubTopicItem key={node.id} node={node} openerAgentId={openerAgentId} />
        ))}
      </Flexbox>
    );
  },
);

SubTopicChildren.displayName = 'SubTopicChildren';

export default SubTopicChildren;
