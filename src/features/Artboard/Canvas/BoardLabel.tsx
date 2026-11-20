import type { ArtboardBoardView } from '@lobechat/types';
import { Icon } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ImageIcon, LockIcon, StarIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { flowStateColor } from '@/features/Acceptance/Viewer/Flow/flowStateColor';
import { sx } from '@/styles/sx';

import StatusTag, { stateIcon } from '../StatusTag';
import { artboardTokens } from '../tokens.stylex';
import { type FlowNodeState, isFlagged } from '../Verify/flow';
import {
  BOARD_LABEL_FONT,
  boardLabelLayout,
  boardLabelScale,
  tagWidth,
  textWidth,
} from './boardLabelLayout';
import ChoiceRadio, { type BoardChoice, RADIO_WIDTH } from './ChoiceRadio';
import RecommendBadge from './RecommendBadge';

const ICON_WIDTH = 16;
const LOCK_WIDTH = 18;
const STATUS_TAG_WIDTH = 84;
const STATUS_TAG_MIN_ROW = 260;

const styles = stylex.create({
  icon: {
    color: cssVar.colorTextTertiary,
    flexShrink: 0,
    marginBlockStart: 5,
  },
  kind: {
    marginInlineEnd: 4,
  },
  lock: {
    marginInlineStart: 6,
  },
  row: {
    alignItems: 'flex-start',
    color: cssVar.colorTextSecondary,
    display: 'flex',
    fontSize: 12,
    height: 24,
    insetBlockEnd: '100%',
    insetInlineStart: 0,
    paddingBlockEnd: 2,
    position: 'absolute',
    transformOrigin: '0 100%',
    whiteSpace: 'nowrap',
  },
  spacer: {
    flexGrow: 1,
  },
  star: {
    color: artboardTokens.accent,
    flexShrink: 0,
    marginBlockStart: 5,
    marginInlineStart: 5,
  },
  state: {
    flexShrink: 0,
    marginBlockStart: 5,
    marginInlineEnd: 4,
  },
  status: {
    flexShrink: 0,
    marginInlineStart: 6,
  },
  tag: {
    borderColor: `color-mix(in srgb, ${artboardTokens.accent} 35%, transparent)`,
    borderRadius: 4,
    borderStyle: 'solid',
    borderWidth: 1,
    color: artboardTokens.accentStrong,
    flexShrink: 0,
    fontSize: 10,
    lineHeight: '13px',
    marginBlockStart: 4,
    marginInlineStart: 6,
    paddingInline: 4,
  },
  title: {
    flexGrow: '0',
    flexShrink: '1',
    flexBasis: 'auto',
    lineHeight: '16px',
    minWidth: 0,
    overflow: 'hidden',
    paddingBlockStart: 3,
    textOverflow: 'ellipsis',
  },
  titleSelected: {
    color: artboardTokens.selection,
  },
});

interface BoardLabelProps {
  board: ArtboardBoardView;
  choice?: BoardChoice;
  k: number;
  linked: boolean;
  recommended: boolean;
  selected: boolean;
  state?: FlowNodeState;
  verify: boolean;
}

const BoardLabel = ({
  board,
  choice,
  k,
  linked,
  recommended,
  selected,
  state,
  verify,
}: BoardLabelProps) => {
  const { t } = useTranslation('project');
  const flagged = verify && linked && isFlagged(state);
  if (board.type === 'decision' && !flagged) return null;

  const recommendedText = t('artboard.board.recommended');
  const image = board.type === 'image';
  const locked = linked && !verify;
  const rowScale = boardLabelScale(k, board.rect.w);
  const statusTag = flagged && !!rowScale && (board.rect.w * k) / rowScale >= STATUS_TAG_MIN_ROW;
  const layout = boardLabelLayout({
    boardWidth: board.rect.w,
    k,
    lead: (choice ? RADIO_WIDTH : 0) + (flagged && !statusTag ? ICON_WIDTH : 0),
    recommended,
    tag: tagWidth(recommendedText),
    title: textWidth(board.title, BOARD_LABEL_FONT) + (image ? ICON_WIDTH : 0),
    trail: (locked ? LOCK_WIDTH : 0) + (statusTag ? STATUS_TAG_WIDTH : 0),
  });
  const badge = layout.badge && (
    <RecommendBadge k={k} label={recommendedText} width={board.rect.w} />
  );
  const { label } = layout;
  if (!label) return badge || null;

  return (
    <>
      <div
        {...sx(styles.row, {
          transform: `scale(${label.scale / k})`,
          width: label.width,
        })}
      >
        {flagged && !statusTag && (
          <Icon
            color={flowStateColor(state)}
            icon={stateIcon(state)}
            size={12}
            {...stylex.props(styles.state)}
          />
        )}
        {choice && <ChoiceRadio {...choice} />}
        {image && <ImageIcon size={12} {...stylex.props(styles.icon, styles.kind)} />}
        <span title={board.title} {...stylex.props(styles.title, selected && styles.titleSelected)}>
          {board.title}
        </span>
        {label.mark === 'tag' && <span {...stylex.props(styles.tag)}>{recommendedText}</span>}
        {label.mark === 'star' && (
          <span aria-label={recommendedText} role="img" title={recommendedText}>
            <StarIcon
              fill="currentColor"
              size={12}
              strokeWidth={1.5}
              {...stylex.props(styles.star)}
            />
          </span>
        )}
        <span {...stylex.props(styles.spacer)} />
        {locked && (
          <span title={t('artboard.board.locked')}>
            <LockIcon size={12} {...stylex.props(styles.icon, styles.lock)} />
          </span>
        )}
        {statusTag && (
          <span {...stylex.props(styles.status)}>
            <StatusTag state={state} />
          </span>
        )}
      </div>
      {badge}
    </>
  );
};

export default BoardLabel;
