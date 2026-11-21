import { ActionIcon, Button, Flexbox, Icon, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ArrowLeftIcon, ChevronLeftIcon, ChevronRightIcon, XIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { sidebarRow } from '@/styles/density.stylex';

import { useBoard } from '../BoardContext';
import StatusTag from '../StatusTag';
import { artboardActions, artboardSelectors, useArtboardStore } from '../store';
import CheckDetail from './CheckDetail';
import { isFlagged, nodeReview, nodeScreenshot, nodeState } from './flow';
import Summary, { useCheckBoards } from './Summary';
import { Thumb } from './Thumb';
import { useAcceptAll } from './useCheckReview';
import { useJourneyView } from './useJourneyView';

const styles = stylex.create({
  back: {
    color: cssVar.colorTextSecondary,
    cursor: 'pointer',
    flex: '1',
    fontSize: 12,
    minWidth: 0,
  },
  clamp: {
    WebkitBoxOrient: 'vertical',
    WebkitLineClamp: 2,
    color: cssVar.colorTextSecondary,
    display: '-webkit-box',
    fontSize: 12,
    lineHeight: 1.6,
    overflow: 'hidden',
  },
  foot: {
    alignItems: 'center',
    borderBlockStartColor: cssVar.colorBorderSecondary,
    borderBlockStartStyle: 'solid',
    borderBlockStartWidth: 1,
    display: 'flex',
    flex: 'none',
    gap: 8,
    paddingBlock: 12,
    paddingInline: 16,
  },
  head: {
    borderBlockEndColor: cssVar.colorBorderSecondary,
    borderBlockEndStyle: 'solid',
    borderBlockEndWidth: 1,
    flex: 'none',
    height: sidebarRow.headerHeight,
    paddingInlineEnd: 10,
    paddingInlineStart: 16,
  },
  panel: {
    backgroundColor: cssVar.colorBgContainer,
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
  },
  row: {
    backgroundColor: {
      ':hover': cssVar.colorFillQuaternary,
      'default': 'transparent',
    },
    borderRadius: cssVar.borderRadius,
    cursor: 'pointer',
    display: 'flex',
    gap: 10,
    paddingBlock: 10,
    paddingInline: 8,
  },
  rowSelected: {
    backgroundColor: cssVar.colorFillTertiary,
    boxShadow: `inset 0 0 0 1px ${cssVar.colorBorder}`,
  },
  scroll: {
    flex: '1',
    minHeight: 0,
    overflowY: 'auto',
  },
  shot: {
    display: 'block',
    height: '100%',
    objectFit: 'cover',
    objectPosition: 'top',
    width: '100%',
  },
  summary: {
    paddingBlockStart: '12px',
    paddingBlockEnd: '4px',
    paddingInline: 16,
  },
  thumb: {
    aspectRatio: '16 / 10',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: 6,
    borderStyle: 'solid',
    borderWidth: 1,
    flex: 'none',
    overflow: 'hidden',
    width: 84,
  },
});

const CheckRow = ({ boardId }: { boardId: string }) => {
  const { t } = useTranslation('project');
  const board = useBoard();
  const journey = useJourneyView();
  const selected = useArtboardStore((s) => s.selected === boardId);
  const item = board.boardById[boardId];
  if (!item) return null;

  const state = nodeState(journey, boardId);
  const review = nodeReview(journey, boardId);
  const shot = nodeScreenshot(journey, boardId);

  return (
    <div
      role="button"
      tabIndex={0}
      {...stylex.props(styles.row, selected && styles.rowSelected)}
      onClick={() => artboardActions.focusItem(boardId)}
      onKeyDown={(event) => {
        if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault();
          artboardActions.focusItem(boardId);
        }
      }}
    >
      {shot ? (
        <div {...stylex.props(styles.thumb)}>
          <img alt={item.title} src={shot} {...stylex.props(styles.shot)} />
        </div>
      ) : (
        <div style={{ flex: 'none', width: 84 }}>
          <Thumb board={item} />
        </div>
      )}
      <Flexbox gap={2} style={{ flex: 1, minWidth: 0 }}>
        <Flexbox horizontal align="center" gap={6} style={{ minWidth: 0 }}>
          <Text ellipsis strong style={{ fontSize: 13 }}>
            {item.title}
          </Text>
          {isFlagged(state) && <StatusTag state={state} />}
        </Flexbox>
        <div {...stylex.props(styles.clamp)}>{item.expected}</div>
        {review && (
          <Text style={{ fontSize: 12 }} type="secondary">
            {t(
              review === 'accepted' ? 'artboard.verify.reviewedTag' : 'artboard.verify.rejectedTag',
            )}
          </Text>
        )}
      </Flexbox>
    </div>
  );
};

const CheckList = () => {
  const { t } = useTranslation('project');
  const checks = useCheckBoards();
  const { acceptAll, count, saving } = useAcceptAll(checks.map((item) => item.id));

  return (
    <>
      <div {...stylex.props(styles.summary)}>
        <Summary />
      </div>
      <div {...stylex.props(styles.scroll)}>
        <Flexbox gap={2} paddingBlock={'4px 12px'} paddingInline={8}>
          {checks.map((item) => (
            <CheckRow boardId={item.id} key={item.id} />
          ))}
        </Flexbox>
      </div>
      {count > 0 && (
        <div {...stylex.props(styles.foot)}>
          <Button loading={saving} type={'primary'} onClick={acceptAll}>
            {t('artboard.verify.acceptAll', { count })}
          </Button>
          <Text style={{ fontSize: 12 }} type="secondary">
            {t('artboard.verify.acceptAllHint')}
          </Text>
        </div>
      )}
    </>
  );
};

const DetailHead = ({ boardId, onClose }: { boardId: string; onClose?: () => void }) => {
  const { t } = useTranslation('project');
  const checks = useCheckBoards();
  const index = checks.findIndex((item) => item.id === boardId);
  const go = (offset: number) => {
    const next = checks[index + offset];
    if (next) artboardActions.focusItem(next.id);
  };

  return (
    <Flexbox horizontal align="center" gap={4} {...stylex.props(styles.head)}>
      <Flexbox
        horizontal
        align="center"
        gap={6}
        {...stylex.props(styles.back)}
        onClick={() => artboardActions.select(null)}
      >
        <Icon icon={ArrowLeftIcon} size={14} />
        {t('artboard.verify.back')}
      </Flexbox>
      <ActionIcon
        disabled={index <= 0}
        icon={ChevronLeftIcon}
        size={'small'}
        title={t('artboard.verify.prev')}
        onClick={() => go(-1)}
      />
      <Text style={{ fontSize: 12, fontVariantNumeric: 'tabular-nums' }} type="secondary">
        {index + 1} / {checks.length}
      </Text>
      <ActionIcon
        disabled={index >= checks.length - 1}
        icon={ChevronRightIcon}
        size={'small'}
        title={t('artboard.verify.next')}
        onClick={() => go(1)}
      />
      {onClose && (
        <ActionIcon
          icon={XIcon}
          size={'small'}
          title={t('artboard.verify.close')}
          onClick={onClose}
        />
      )}
    </Flexbox>
  );
};

const VerifyPanel = ({ onClose }: { onClose?: () => void }) => {
  const { t } = useTranslation('project');
  const board = useBoard();
  const selected = useArtboardStore(artboardSelectors.selectedCheckBoard(board));

  return (
    <div {...stylex.props(styles.panel)}>
      {selected ? (
        <>
          <DetailHead boardId={selected} onClose={onClose} />
          <CheckDetail boardId={selected} />
        </>
      ) : (
        <>
          <Flexbox horizontal align="center" gap={8} {...stylex.props(styles.head)}>
            <Text strong style={{ flex: 1 }}>
              {t('artboard.verify.title')}
            </Text>
            {onClose && (
              <ActionIcon
                icon={XIcon}
                size={'small'}
                title={t('artboard.verify.close')}
                onClick={onClose}
              />
            )}
          </Flexbox>
          <CheckList />
        </>
      )}
    </div>
  );
};

export default VerifyPanel;
