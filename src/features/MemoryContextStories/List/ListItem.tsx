import { type MemoryContextStorySummary } from '@lobechat/types';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';

import { useStoryFormat } from '../format';

const styles = stylex.create({
  row: {
    alignItems: 'flex-start',
    backgroundColor: { 'default': 'transparent', ':hover': cssVar.colorFillTertiary },
    borderRadius: cssVar.borderRadius,
    borderStyle: 'none',
    color: cssVar.colorText,
    cursor: 'pointer',
    display: 'flex',
    gap: '12px',
    paddingBlock: '8px',
    paddingInline: '8px',
    textAlign: 'start',
    width: '100%',
  },
  active: {
    backgroundColor: { 'default': cssVar.colorFillSecondary, ':hover': cssVar.colorFillSecondary },
  },
  muted: { opacity: 0.6 },
  dot: {
    borderRadius: '50%',
    flexShrink: 0,
    height: '6px',
    marginBlockStart: '8px',
    width: '6px',
  },
  dotActive: { backgroundColor: cssVar.colorSuccess },
  dotDormant: { backgroundColor: cssVar.colorWarning },
  dotClosed: { backgroundColor: cssVar.colorTextQuaternary },
  body: { display: 'flex', flex: '1', flexDirection: 'column', gap: '2px', minWidth: 0 },
  titleLine: { alignItems: 'baseline', display: 'flex', gap: '8px' },
  title: {
    flex: '1',
    fontSize: '14px',
    fontWeight: 500,
    lineHeight: '20px',
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  meta: {
    color: cssVar.colorTextTertiary,
    flexShrink: 0,
    fontSize: '12px',
    fontVariantNumeric: 'tabular-nums',
  },
  now: {
    color: cssVar.colorTextSecondary,
    fontSize: '12px',
    lineHeight: '18px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
});

const DOT = { active: styles.dotActive, closed: styles.dotClosed, dormant: styles.dotDormant };

interface ListItemProps {
  active: boolean;
  onSelect: (id: string) => void;
  story: MemoryContextStorySummary;
}

/**
 * One row answers "what is it and how is it going": status, title, the first line of "now", and
 * when it last moved.
 */
const ListItem = memo<ListItemProps>(({ active, onSelect, story }) => {
  const format = useStoryFormat();
  return (
    <button
      aria-current={active ? 'page' : undefined}
      type={'button'}
      {...stylex.props(
        styles.row,
        active && styles.active,
        story.status === 'closed' && styles.muted,
      )}
      onClick={() => onSelect(story.id)}
    >
      <span aria-hidden {...stylex.props(styles.dot, DOT[story.status])} />
      <span {...stylex.props(styles.body)}>
        <span {...stylex.props(styles.titleLine)}>
          <span {...stylex.props(styles.title)}>{story.title || format.t('entity.untitled')}</span>
          {story.lastEvidenceAt && (
            <span {...stylex.props(styles.meta)}>{format.ago(story.lastEvidenceAt)}</span>
          )}
        </span>
        {story.now && <span {...stylex.props(styles.now)}>{story.now}</span>}
      </span>
    </button>
  );
});

ListItem.displayName = 'StoryListItem';

export default ListItem;
