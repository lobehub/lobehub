import { Icon } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { CheckIcon, MessageSquareQuoteIcon, XIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

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

export const ReferArtboardView = memo<ReferArtboardViewProps>(({ onRemove, reference }) => {
  const { t } = useTranslation('project');
  const target =
    reference.itemKind === 'frame'
      ? reference.itemTitle
      : t('artboard.chat.stickyTarget', { text: reference.itemTitle });
  const body =
    reference.kind === 'decision'
      ? t('artboard.chat.decided', { text: reference.text })
      : reference.text;

  return (
    <span {...stylex.props(styles.root)}>
      <Icon icon={reference.kind === 'decision' ? CheckIcon : MessageSquareQuoteIcon} size={12} />
      <span {...stylex.props(styles.target)}>{target}</span>
      <span {...stylex.props(styles.body)}>{body}</span>
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
  );
});

ReferArtboardView.displayName = 'ReferArtboardView';
