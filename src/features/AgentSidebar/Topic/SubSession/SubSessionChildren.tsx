'use client';

import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import { useSubSessionTree } from './context';
import SubSessionItem from './SubSessionItem';

/** Indent of nested sub-session rows: one level, under the opener's title. */
const SUB_SESSION_INDENT = 20;

/** An unfolded opener's sub-sessions. Renders nothing while folded or off. */
const SubSessionChildren = memo<{ openerAgentId?: string; topicId: string }>(
  ({ openerAgentId, topicId }) => {
    const tree = useSubSessionTree();
    if (!tree || !tree.isExpanded(topicId)) return null;
    const nodes = tree.childrenOf(topicId);
    if (nodes.length === 0) return null;

    return (
      <Flexbox
        data-testid="sub-session-children"
        gap={1}
        style={{ paddingInlineStart: SUB_SESSION_INDENT }}
      >
        {nodes.map((node) => (
          <SubSessionItem key={node.id} node={node} openerAgentId={openerAgentId} />
        ))}
      </Flexbox>
    );
  },
);

SubSessionChildren.displayName = 'SubSessionChildren';

export default SubSessionChildren;
