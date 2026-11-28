'use client';

import { Button, Flexbox, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import dayjs from 'dayjs';
import { memo, type ReactNode, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  buildRoundCards,
  type RoundCardModel,
  roundStateMeta,
  type RoundTone,
} from '@/features/Acceptance/Viewer/History/roundState';
import type { AcceptanceBundle } from '@/services/verify';
import { sx } from '@/styles/sx';

/** Older rounds shown before "show earlier" — a goal loop can run a dozen. */
const VISIBLE_EARLIER_ROUNDS = 3;

const TONE_COLOR: Record<RoundTone, string> = {
  error: cssVar.colorError,
  info: cssVar.colorInfo,
  neutral: cssVar.colorTextSecondary,
  success: cssVar.colorSuccess,
  warning: cssVar.colorWarning,
};

const styles = stylex.create({
  dot: {
    backgroundColor: cssVar.colorBgContainer,
    borderColor: cssVar.colorTextQuaternary,
    borderRadius: '50%',
    borderStyle: 'solid',
    borderWidth: 1.5,
    height: 9,
    insetInlineStart: -18,
    position: 'absolute',
    width: 9,
  },
  dotCurrent: {
    borderColor: 'currentcolor',
    backgroundColor: 'currentcolor',
  },
  earlier: {
    height: 32,
  },
  item: {
    position: 'relative',
  },
  meta: {
    color: cssVar.colorTextTertiary,
    flexShrink: 0,
    fontSize: 12,
    whiteSpace: 'nowrap',
  },
  // The rail the rounds hang on: one hairline, the dots sit across it.
  rail: {
    'display': 'flex',
    'flexDirection': 'column',
    'listStyle': 'none',
    'margin': 0,
    'paddingInlineStart': 20,
    'position': 'relative',
    '::before': {
      backgroundColor: cssVar.colorBorderSecondary,
      bottom: 12,
      content: '""',
      insetInlineStart: 6,
      position: 'absolute',
      top: 12,
      width: 1,
    },
  },
  state: {
    flexShrink: 0,
    fontSize: 12,
    whiteSpace: 'nowrap',
  },
});

interface RoundLineProps {
  card: RoundCardModel;
  current?: boolean;
  extra?: ReactNode;
}

const RoundLine = memo<RoundLineProps>(({ card, current, extra }) => {
  const { t } = useTranslation('verify');
  const meta = roundStateMeta(card.state, t);
  const color = TONE_COLOR[meta.tone];
  const { run } = card.round;

  return (
    <Flexbox horizontal align={'center'} gap={8} style={{ minHeight: 32, minWidth: 0 }}>
      <span {...sx(styles.dot, current && styles.dotCurrent, { color, top: current ? 12 : 11 })} />
      <Text style={{ flex: 'none' }} type={current ? undefined : 'secondary'} weight={500}>
        {t('acceptance.round', { round: run.roundIndex })}
      </Text>
      <Text ellipsis style={{ flex: 1, minWidth: 0 }} type={'secondary'}>
        {run.title}
      </Text>
      <span {...sx(styles.state, { color })}>{meta.label}</span>
      {card.total > 0 && (
        <span {...stylex.props(styles.meta)}>
          {t('acceptance.roundState.summary', { accepted: card.accepted, total: card.total })}
        </span>
      )}
      <span {...stylex.props(styles.meta)}>{dayjs(run.createdAt).format('MM-DD HH:mm')}</span>
      {extra}
    </Flexbox>
  );
});

RoundLine.displayName = 'TaskAcceptanceRoundLine';

interface TaskAcceptanceRoundsProps {
  bundle: AcceptanceBundle;
  /** The latest round's checklist, opened under its heading. */
  children: ReactNode;
  /** Controls for the latest round's checklist (expand / collapse groups). */
  latestExtra?: ReactNode;
}

/**
 * The delivery's rounds as one timeline, newest first: the latest round open
 * with its checklist, each earlier round one line with its state and how many
 * of its checks were accepted.
 */
const TaskAcceptanceRounds = memo<TaskAcceptanceRoundsProps>(
  ({ bundle, children, latestExtra }) => {
    const { t } = useTranslation('chat');
    const [showAll, setShowAll] = useState(false);
    const cards = useMemo(() => buildRoundCards(bundle), [bundle]);

    // No round yet: nothing to hang the checklist on.
    if (cards.length === 0) return children;

    const [latest, ...earlier] = cards;
    const hidden = showAll ? 0 : Math.max(0, earlier.length - VISIBLE_EARLIER_ROUNDS);
    const shown = hidden > 0 ? earlier.slice(0, VISIBLE_EARLIER_ROUNDS) : earlier;

    return (
      <ol {...stylex.props(styles.rail)}>
        <li {...stylex.props(styles.item)}>
          <RoundLine current card={latest} extra={latestExtra} />
          <Flexbox paddingBlock={'4px 8px'}>{children}</Flexbox>
        </li>
        {shown.map((card) => (
          <li
            key={card.round.run.id ?? card.round.run.roundIndex}
            {...stylex.props(styles.item, styles.earlier)}
          >
            <RoundLine card={card} />
          </li>
        ))}
        {hidden > 0 && (
          <li>
            <Button size={'small'} type={'text'} onClick={() => setShowAll(true)}>
              {t('taskDetail.acceptance.showEarlierRounds', { count: hidden })}
            </Button>
          </li>
        )}
      </ol>
    );
  },
);

TaskAcceptanceRounds.displayName = 'TaskAcceptanceRounds';

export default TaskAcceptanceRounds;
