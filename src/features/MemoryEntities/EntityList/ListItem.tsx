import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';

import KindIcon from '../components/KindIcon';
import { useEntityFormat } from '../format';
import { type MemoryEntity } from '../types';

const styles = stylex.create({
  row: {
    alignItems: 'flex-start',
    backgroundColor: {
      'default': 'transparent',
      ':hover': cssVar.colorFillTertiary,
    },
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
    backgroundColor: {
      'default': cssVar.colorFillSecondary,
      ':hover': cssVar.colorFillSecondary,
    },
  },
  muted: { opacity: 0.6 },
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

interface ListItemProps {
  active: boolean;
  entity: MemoryEntity;
  lastTouchedAt: string;
  muted?: boolean;
  onSelect: (id: string) => void;
}

/**
 * One row answers "what is it and how is it going": kind, title, the first line of "now", and
 * one time on the right that always means the same thing — when it last moved.
 */
const ListItem = memo<ListItemProps>(({ active, entity, lastTouchedAt, muted, onSelect }) => {
  const format = useEntityFormat();
  return (
    <button
      aria-current={active ? 'page' : undefined}
      type={'button'}
      {...stylex.props(styles.row, active && styles.active, muted && styles.muted)}
      onClick={() => onSelect(entity.id)}
    >
      <KindIcon kind={entity.kind} />
      <span {...stylex.props(styles.body)}>
        <span {...stylex.props(styles.titleLine)}>
          <span {...stylex.props(styles.title)}>{format.title(entity)}</span>
          <span {...stylex.props(styles.meta)}>{format.ago(lastTouchedAt)}</span>
        </span>
        <span {...stylex.props(styles.now)}>{entity.summary || entity.description}</span>
      </span>
    </button>
  );
});

ListItem.displayName = 'EntityListItem';

export default ListItem;
