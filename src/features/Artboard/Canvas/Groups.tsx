import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { LockIcon } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { sx } from '@/styles/sx';

import { useBoard } from '../BoardContext';
import { useArtboardStore } from '../store';
import { GROUP_LABEL_GAP, groupChip, groupLabelScale, roundOrder } from './groupLabel';

const DESC_MIN_SCREEN_SPAN = 420;

const styles = stylex.create({
  chip: {
    alignItems: 'center',
    backgroundColor: cssVar.colorText,
    borderRadius: 4,
    color: cssVar.colorBgContainer,
    display: 'inline-flex',
    flexShrink: 0,
    fontFamily: cssVar.fontFamilyCode,
    fontSize: 11,
    fontWeight: 500,
    height: 18,
    lineHeight: '18px',
    paddingInline: 5,
  },
  desc: {
    color: cssVar.colorTextSecondary,
    flexGrow: '0',
    flexShrink: '100',
    flexBasis: 'auto',
    fontWeight: 400,
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  label: {
    alignItems: 'center',
    color: cssVar.colorText,
    display: 'flex',
    fontSize: 13,
    fontWeight: 600,
    gap: 6,
    pointerEvents: 'none',
    position: 'absolute',
    transformOrigin: '0 0',
    transitionDuration: '0.25s',
    transitionProperty: 'opacity',
    whiteSpace: 'nowrap',
    width: 'max-content',
  },
  title: {
    flexGrow: '0',
    flexShrink: '1',
    flexBasis: 'auto',
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
});

const Groups = ({ k }: { k: number }) => {
  const { t } = useTranslation('project');
  const board = useBoard();
  const verify = useArtboardStore((s) => s.mode === 'verify');
  const numberOf = useMemo(
    () => roundOrder(board.artboard.content.rounds, board.pageId),
    [board.artboard.content.rounds, board.pageId],
  );

  return board.groups.map((group) => {
    const members = board.boards.filter((b) => b.groupId === group.id);
    if (!members.length) return null;
    const x = Math.min(...members.map((b) => b.rect.x));
    const y = Math.min(...members.map((b) => b.rect.y));
    const span = Math.max(...members.map((b) => b.rect.x + b.rect.w)) - x;
    const screenScale = groupLabelScale(k, y - group.rect.y);
    if (screenScale === null) return null;
    const scale = screenScale / k;

    const journey = group.id === board.journeyGroupId;
    const locked = board.finalized && journey;
    const round = board.roundByGroupId[group.id];
    const chip = groupChip({ locked, roundNumber: round && numberOf[round.id] });
    const desc = locked
      ? t(verify ? 'artboard.group.verifyDesc' : 'artboard.group.lockedDesc')
      : round
        ? round.title || t('artboard.group.choose')
        : group.desc;
    return (
      <div
        data-group-label={group.id}
        key={group.id}
        {...sx(styles.label, {
          left: x,
          maxWidth: span / scale,
          opacity: verify && !journey ? 0.3 : 1,
          top: y,
          transform: `translateY(-${GROUP_LABEL_GAP * scale}px) scale(${scale}) translateY(-100%)`,
        })}
      >
        {chip && (
          <span {...stylex.props(styles.chip)}>
            {chip.kind === 'lock' ? <LockIcon size={11} strokeWidth={2.25} /> : chip.text}
          </span>
        )}
        <span {...stylex.props(styles.title)}>{group.title}</span>
        {desc && span * k > DESC_MIN_SCREEN_SPAN && (
          <span {...stylex.props(styles.desc)}>{desc}</span>
        )}
      </div>
    );
  });
};

export default Groups;
