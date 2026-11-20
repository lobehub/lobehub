import { Flexbox, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { useTranslation } from 'react-i18next';

import StatusTag from '../StatusTag';
import { artboardActions, useArtboardStore } from '../store';
import { isFlagged, nodeAttempts, nodeScreenshot, nodeState } from './flow';
import ReviewActions from './ReviewActions';
import Summary, { useCheckBoards } from './Summary';
import { EmptyThumb, Thumb, thumbStyles } from './Thumb';
import { useJourneyView } from './useJourneyView';

const styles = stylex.create({
  card: {
    backgroundColor: cssVar.colorBgContainer,
    columnGap: 16,
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) 176px 176px max-content',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadiusLG,
    borderStyle: 'solid',
    borderWidth: 1,
    overflow: 'hidden',
  },
  clamp: {
    WebkitBoxOrient: 'vertical',
    fontSize: 12,
    WebkitLineClamp: 2,
    display: '-webkit-box',
    overflow: 'hidden',
  },
  grid: {
    alignItems: 'center',
    display: 'grid',
    gridColumnEnd: '-1',
    gridColumnStart: '1',
    gridTemplateColumns: 'subgrid',
    paddingBlock: 12,
    paddingInline: 16,
  },
  gridNarrow: {
    gridTemplateColumns: 'minmax(0, 1fr) 128px',
  },
  head: {
    borderBlockEndColor: cssVar.colorBorderSecondary,
    borderBlockEndStyle: 'solid',
    borderBlockEndWidth: 1,
    color: cssVar.colorTextTertiary,
    fontSize: 12,
    paddingBlock: 8,
  },
  row: {
    backgroundColor: {
      ':hover': cssVar.colorFillQuaternary,
      'default': 'transparent',
    },
    borderBlockEndColor: cssVar.colorBorderSecondary,
    borderBlockEndStyle: 'solid',
    borderBlockEndWidth: {
      ':last-child': 0,
      'default': 1,
    },
    cursor: 'pointer',
  },
  rowSelected: {
    backgroundColor: cssVar.colorFillTertiary,
  },
  stage: {
    height: '100%',
    overflowY: 'auto',
    padding: 16,
  },
});

const CheckRow = ({ boardId, narrow }: { boardId: string; narrow: boolean }) => {
  const { t } = useTranslation('project');
  const journey = useJourneyView();
  const selected = useArtboardStore((s) => s.selected === boardId);
  const checks = useCheckBoards();
  const item = checks.find((check) => check.id === boardId);
  if (!item) return null;

  const state = nodeState(journey, boardId);
  const shot = nodeScreenshot(journey, boardId);
  const observation = isFlagged(state) ? nodeAttempts(journey, boardId)[0]?.observation : null;

  return (
    <div
      {...stylex.props(styles.grid, styles.row, selected && styles.rowSelected)}
      role="button"
      tabIndex={0}
      onClick={() => artboardActions.select(boardId)}
      onKeyDown={(event) => {
        if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault();
          artboardActions.select(boardId);
        }
      }}
    >
      <Flexbox gap={4} style={{ minWidth: 0 }}>
        <Flexbox horizontal align="center" gap={8} style={{ minWidth: 0 }}>
          {isFlagged(state) && <StatusTag state={state} />}
          <Text ellipsis strong style={{ fontSize: 13 }}>
            {item.title}
          </Text>
        </Flexbox>
        <Text type="secondary" {...stylex.props(styles.clamp)}>
          {item.expected}
        </Text>
        {observation && (
          <Text type="danger" {...stylex.props(styles.clamp)}>
            {observation}
          </Text>
        )}
        {narrow && <ReviewActions compact boardId={boardId} state={state} />}
      </Flexbox>
      {!narrow && <Thumb board={item} />}
      {shot ? (
        <div {...stylex.props(thumbStyles.box)}>
          <img
            alt={item.title}
            src={shot}
            style={{ height: '100%', objectFit: 'cover', objectPosition: 'top', width: '100%' }}
          />
        </div>
      ) : (
        <EmptyThumb>{t('artboard.verify.noShot')}</EmptyThumb>
      )}
      {!narrow && <ReviewActions compact boardId={boardId} state={state} />}
    </div>
  );
};

const CheckTable = ({ narrow }: { narrow: boolean }) => {
  const { t } = useTranslation('project');
  const checks = useCheckBoards();

  return (
    <div {...stylex.props(styles.stage)}>
      <Flexbox gap={12}>
        <Summary />
        <div {...stylex.props(styles.card, narrow && styles.gridNarrow)}>
          <div {...stylex.props(styles.grid, styles.head)}>
            <span>{t('artboard.verifyList.check')}</span>
            {!narrow && <span>{t('artboard.verifyList.design')}</span>}
            <span>{t('artboard.verify.realShot')}</span>
            {!narrow && <span>{t('artboard.verify.reviewTitle')}</span>}
          </div>
          {checks.map((item) => (
            <CheckRow boardId={item.id} key={item.id} narrow={narrow} />
          ))}
        </div>
      </Flexbox>
    </div>
  );
};

export default CheckTable;
