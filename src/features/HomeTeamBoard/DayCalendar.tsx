import type { AgentRunBoardData } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import dayjs from 'dayjs';
import { useTranslation } from 'react-i18next';

import { sx } from '@/styles/sx';

import { buildHourCells, type HourCellItem } from './layout';
import { RUN_STATUS_VISUALS } from './statusVisuals';
import { useOpenRunDrawer } from './useOpenRunDrawer';

const MAX_CELL_ITEMS = 3;

const styles = stylex.create({
  card: {
    backgroundColor: cssVar.colorBgContainer,
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: 12,
    borderStyle: 'solid',
    borderWidth: 1,
    minWidth: 0,
    paddingBlock: 16,
    paddingInline: 16,
  },
  cell: {
    backgroundColor: cssVar.colorFillQuaternary,
    borderRadius: 8,
    boxSizing: 'border-box',
    minHeight: 104,
    minWidth: 0,
    paddingBlock: 8,
    paddingInline: 8,
  },
  current: { outlineColor: cssVar.colorPrimary, outlineStyle: 'solid', outlineWidth: 1 },
  dot: { borderRadius: 3, flexShrink: 0, height: 6, width: 6 },
  grid: { display: 'grid', gap: 8, gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' },
  hour: {
    color: cssVar.colorTextTertiary,
    fontSize: 12,
    fontVariantNumeric: 'tabular-nums',
  },
  item: {
    alignItems: 'center',
    backgroundColor: { 'default': 'transparent', ':hover': cssVar.colorFillSecondary },
    borderRadius: 4,
    borderStyle: 'none',
    borderWidth: 0,
    color: cssVar.colorTextSecondary,
    cursor: { 'default': 'pointer', ':disabled': 'default' },
    display: 'flex',
    fontSize: 12,
    gap: 6,
    paddingBlock: 1,
    paddingInline: 2,
    textAlign: 'start',
    width: '100%',
  },
  more: { color: cssVar.colorTextTertiary, fontSize: 12, paddingInline: 2 },
  title: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
});

const CalendarItem = ({ item }: { item: HourCellItem }) => {
  const { t } = useTranslation('home');
  const openDrawer = useOpenRunDrawer();
  const { agentId, run } = item;
  const title = run.title || t('team.run.untitled');

  return (
    <button
      data-status={run.status}
      data-testid={'team-board-calendar-run'}
      disabled={!run.topicId}
      title={`${title} · ${t(`team.status.${run.status}`)}`}
      type={'button'}
      {...stylex.props(styles.item)}
      onClick={() =>
        openDrawer({
          agentId,
          runningOperation: run.runningOperation,
          title,
          topicId: run.topicId,
        })
      }
    >
      <span {...sx(styles.dot, { backgroundColor: RUN_STATUS_VISUALS[run.status].color })} />
      <span {...stylex.props(styles.title)}>{title}</span>
    </button>
  );
};

/** A day reads best as a calendar: 24 hour cells, each listing what started in it. */
const DayCalendar = ({ board }: { board: AgentRunBoardData }) => {
  const { t } = useTranslation('home');
  const cells = buildHourCells(board.lanes, board.generatedAt);

  return (
    <div {...stylex.props(styles.card)}>
      <div {...stylex.props(styles.grid)} data-testid={'team-board-calendar'}>
        {cells.map((cell, index) => (
          <Flexbox
            gap={2}
            key={cell.hour.getTime()}
            {...stylex.props(styles.cell, index === cells.length - 1 && styles.current)}
            data-testid={'team-board-calendar-cell'}
          >
            <span {...stylex.props(styles.hour)}>{dayjs(cell.hour).format('HH:00')}</span>
            {cell.items.slice(0, MAX_CELL_ITEMS).map((item) => (
              <CalendarItem item={item} key={item.run.id} />
            ))}
            {cell.items.length > MAX_CELL_ITEMS && (
              <span {...stylex.props(styles.more)}>
                {t('team.calendar.more', { count: cell.items.length - MAX_CELL_ITEMS })}
              </span>
            )}
          </Flexbox>
        ))}
      </div>
    </div>
  );
};

export default DayCalendar;
