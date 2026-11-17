'use client';

import { Flexbox, Icon, Tooltip } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ChevronRight } from 'lucide-react';
import { memo, type MouseEvent, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import type { ChatTopic } from '@/types/topic';

import { useCollapsedIndicators } from '../TopicListContent/ByProjectMode/CollapsedIndicators';
import { toRollupStatus } from './buildSubSessionTree';
import { useSubSessionTree } from './context';

const styles = stylex.create({
  chevron: { transitionDuration: '150ms', transitionProperty: 'transform' },
  chevronOpen: { transform: 'rotate(90deg)' },
  toggle: {
    alignItems: 'center',
    borderRadius: '4px',
    color: { 'default': cssVar.colorTextTertiary, ':hover': cssVar.colorText },
    cursor: 'pointer',
    display: 'inline-flex',
    flexShrink: 0,
    fontSize: '12px',
    gap: '2px',
    paddingInline: '4px',
    backgroundColor: { 'default': 'transparent', ':hover': cssVar.colorFillTertiary },
    backgroundImage: 'none',
    borderWidth: 0,
    borderStyle: 'none',
    fontFamily: 'inherit',
    lineHeight: '18px',
  },
});

/**
 * On an opener row: how many sub-sessions it has, folded or unfolded, and —
 * while folded — whether any of them is running or needs the user.
 */
const SubSessionToggle = memo<{ topicId: string }>(({ topicId }) => {
  const { t } = useTranslation('topic');
  const tree = useSubSessionTree();
  const nodes = tree?.childrenOf(topicId);
  const expanded = tree?.isExpanded(topicId) ?? false;
  const asTopics = useMemo(
    () =>
      (nodes ?? []).map(
        (node) => ({ id: node.id, status: toRollupStatus(node.state) }) as ChatTopic,
      ),
    [nodes],
  );
  const { indicators } = useCollapsedIndicators(asTopics, expanded);

  if (!tree || !nodes || nodes.length === 0) return null;

  const onClick = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    tree.toggle(topicId);
  };

  return (
    <Flexbox horizontal align={'center'} gap={4}>
      {indicators}
      <Tooltip
        title={t(expanded ? 'subSession.collapse' : 'subSession.expand', { count: nodes.length })}
      >
        <button
          aria-expanded={expanded}
          data-testid="sub-session-toggle"
          type={'button'}
          aria-label={t(expanded ? 'subSession.collapse' : 'subSession.expand', {
            count: nodes.length,
          })}
          onClick={onClick}
          {...stylex.props(styles.toggle)}
        >
          {nodes.length}
          <Icon
            icon={ChevronRight}
            size={12}
            {...stylex.props(styles.chevron, expanded && styles.chevronOpen)}
          />
        </button>
      </Tooltip>
    </Flexbox>
  );
});

SubSessionToggle.displayName = 'SubSessionToggle';

export default SubSessionToggle;
