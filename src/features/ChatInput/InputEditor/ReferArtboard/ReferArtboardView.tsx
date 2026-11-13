import { Icon } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { MessageSquareQuoteIcon, XIcon } from 'lucide-react';
import { memo } from 'react';

import type { ArtboardReference } from './serialize';

const styles = stylex.create({
  body: {
    color: cssVar.colorText,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  close: {
    color: cssVar.colorTextTertiary,
    cursor: 'pointer',
    display: 'inline-flex',
  },
  root: {
    alignItems: 'center',
    backgroundColor: cssVar.colorFillTertiary,
    borderInlineStartColor: cssVar.colorPrimary,
    borderInlineStartStyle: 'solid',
    borderInlineStartWidth: 2,
    borderRadius: cssVar.borderRadiusSM,
    display: 'inline-flex',
    fontSize: 12,
    gap: 6,
    lineHeight: '20px',
    maxWidth: '100%',
    paddingBlock: 2,
    paddingInline: 8,
    userSelect: 'none',
    verticalAlign: 'middle',
  },
  target: {
    color: cssVar.colorTextSecondary,
    flexShrink: 0,
  },
});

interface ReferArtboardViewProps {
  onRemove?: () => void;
  reference: ArtboardReference;
}

export const ReferArtboardView = memo<ReferArtboardViewProps>(({ onRemove, reference }) => (
  <span {...stylex.props(styles.root)}>
    <Icon icon={MessageSquareQuoteIcon} size={12} />
    <span {...stylex.props(styles.target)}>{reference.itemTitle}</span>
    <span {...stylex.props(styles.body)}>{reference.text}</span>
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
