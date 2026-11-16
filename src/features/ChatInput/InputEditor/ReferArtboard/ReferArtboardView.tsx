import { Icon } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { MessageSquareQuoteIcon, XIcon } from 'lucide-react';
import { memo } from 'react';

import type { ArtboardReference } from './serialize';

const styles = stylex.create({
  body: {
    WebkitBoxOrient: 'vertical',
    WebkitLineClamp: 3,
    color: cssVar.colorText,
    display: '-webkit-box',
    overflow: 'hidden',
    whiteSpace: 'pre-line',
  },
  close: {
    alignItems: 'center',
    color: cssVar.colorTextTertiary,
    cursor: 'pointer',
    display: 'inline-flex',
    flexShrink: 0,
    height: 20,
    marginInlineStart: 'auto',
  },
  content: {
    display: 'flex',
    flex: '1',
    flexDirection: 'column',
    minWidth: 0,
  },
  icon: {
    alignItems: 'center',
    color: cssVar.colorTextSecondary,
    display: 'inline-flex',
    flexShrink: 0,
    height: 20,
  },
  root: {
    alignItems: 'flex-start',
    backgroundColor: cssVar.colorFillTertiary,
    borderRadius: cssVar.borderRadius,
    boxSizing: 'border-box',
    display: 'flex',
    fontSize: 12,
    gap: 8,
    lineHeight: '20px',
    paddingBlock: 6,
    paddingInline: 10,
    userSelect: 'none',
    width: '100%',
  },
  target: {
    color: cssVar.colorTextSecondary,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
});

interface ReferArtboardViewProps {
  onRemove?: () => void;
  reference: ArtboardReference;
}

export const ReferArtboardView = memo<ReferArtboardViewProps>(({ onRemove, reference }) => (
  <span {...stylex.props(styles.root)}>
    <span {...stylex.props(styles.icon)}>
      <Icon icon={MessageSquareQuoteIcon} size={12} />
    </span>
    <span {...stylex.props(styles.content)}>
      <span {...stylex.props(styles.target)}>{reference.itemTitle}</span>
      {reference.text && <span {...stylex.props(styles.body)}>{reference.text}</span>}
    </span>
    {onRemove && (
      <span
        {...stylex.props(styles.close)}
        onClick={(event) => {
          event.stopPropagation();
          onRemove();
        }}
      >
        <Icon icon={XIcon} size={12} />
      </span>
    )}
  </span>
));

ReferArtboardView.displayName = 'ReferArtboardView';
