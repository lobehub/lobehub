'use client';

import { MoreHorizontal } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import NavItem from '@/features/NavPanel/components/NavItem';
import { useChatStore } from '@/store/chat';

import type { SubTopicNode } from './buildSubTopicTree';
import SubTopicItem from './SubTopicItem';

/** Rows drawn at first and per "show more": the tree itself has no cap. */
export const SUB_TOPIC_PAGE_SIZE = 20;

/** How many of `count` rows to draw: whole pages, and always the open conversation. */
export const visibleSubTopicCount = (count: number, pages: number, activeIndex: number) =>
  Math.min(count, Math.max(pages * SUB_TOPIC_PAGE_SIZE, activeIndex + 1));

/** A list of sub-topic rows, paged so a wide tree cannot flood the sidebar. */
const SubTopicRows = memo<{ nodes: SubTopicNode[]; openerAgentId?: string }>(
  ({ nodes, openerAgentId }) => {
    const { t } = useTranslation('topic');
    const activeTopicId = useChatStore((s) => s.activeTopicId);
    const [pages, setPages] = useState(1);

    const activeIndex = nodes.findIndex((node) => node.id === activeTopicId);
    const shown = visibleSubTopicCount(nodes.length, pages, activeIndex);
    const remaining = nodes.length - shown;

    return (
      <>
        {nodes.slice(0, shown).map((node) => (
          <SubTopicItem key={node.id} node={node} openerAgentId={openerAgentId} />
        ))}
        {remaining > 0 && (
          <NavItem
            icon={MoreHorizontal}
            title={t('subTopic.showMore', { count: remaining })}
            onClick={() => setPages(Math.ceil(shown / SUB_TOPIC_PAGE_SIZE) + 1)}
          />
        )}
      </>
    );
  },
);

SubTopicRows.displayName = 'SubTopicRows';

export default SubTopicRows;
