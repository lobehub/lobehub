'use client';

import { Icon } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import dayjs from 'dayjs';
import { ChevronRight } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useIsHydrated } from '@/hooks/useIsHydrated';

import DecisionStrip from '../Review/DecisionStrip';
import { type AcceptanceRound, type RoundCardModel, roundStateMeta } from './roundState';

const styles = stylex.create({
  card: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    width: '100%',
    margin: '0',
    paddingBlock: '12px',
    paddingInline: '12px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: '8px',
    font: 'inherit',
    color: cssVar.colorText,
    textAlign: 'start',
    backgroundColor: cssVar.colorBgContainer,
    backgroundImage: 'none',
  },
  openable: {
    cursor: 'pointer',
    appearance: 'none',
    borderColor: { 'default': cssVar.colorBorderSecondary, ':hover': cssVar.colorBorder },
    outlineWidth: { 'default': null, ':focus-visible': '2px' },
    outlineStyle: { 'default': null, ':focus-visible': 'solid' },
    outlineColor: { 'default': null, ':focus-visible': cssVar.colorPrimary },
    outlineOffset: { 'default': null, ':focus-visible': '2px' },
  },
  active: {
    borderColor: { 'default': cssVar.colorPrimary, ':hover': cssVar.colorPrimary },
  },
  line: { display: 'flex', gap: '8px', alignItems: 'center', minWidth: 0 },
  name: { fontSize: '14px', fontWeight: 600, lineHeight: '22px' },
  spacer: { flex: '1' },
  secondary: { fontSize: '12px', lineHeight: '20px', color: cssVar.colorTextSecondary },
  tertiary: {
    flex: 'none',
    fontSize: '12px',
    fontVariantNumeric: 'tabular-nums',
    lineHeight: '20px',
    color: cssVar.colorTextTertiary,
  },
  chevron: { display: 'inline-flex', flex: 'none', color: cssVar.colorTextQuaternary },
  wrap: { overflowWrap: 'anywhere' },
  state: {
    display: 'inline-flex',
    flex: 'none',
    gap: '4px',
    alignItems: 'center',
    fontSize: '12px',
    lineHeight: '20px',
  },
  error: { color: cssVar.colorErrorText },
  info: { color: cssVar.colorInfo },
  neutral: { color: cssVar.colorTextSecondary },
  success: { color: cssVar.colorSuccessText },
  warning: { color: cssVar.colorWarningText },
  strip: { marginBlockStart: '4px' },
});

interface RoundCardProps {
  active: boolean;
  card: RoundCardModel;
  onOpen: (round: AcceptanceRound) => void;
}

const RoundCard = memo<RoundCardProps>(({ active, card, onOpen }) => {
  const { t } = useTranslation('verify');
  const hydrated = useIsHydrated();
  const { accepted, isLatest, openable, round, segments, state, total } = card;
  const meta = roundStateMeta(state, t);
  const reason =
    state === 'rejected' ? card.reason || t('acceptance.banner.rejectedHint') : undefined;

  const body = (
    <>
      <span {...stylex.props(styles.line)}>
        <span {...stylex.props(styles.name)}>
          {t('acceptance.round', { round: round.run.roundIndex })}
        </span>
        {isLatest && (
          <span {...stylex.props(styles.secondary)}>{t('acceptance.ledger.latest')}</span>
        )}
        <span {...stylex.props(styles.spacer)} />
        <span {...stylex.props(styles.tertiary)}>
          {hydrated ? dayjs(round.run.createdAt).format('MM-DD HH:mm') : null}
        </span>
        {openable && (
          <span {...stylex.props(styles.chevron)}>
            <Icon icon={ChevronRight} size={14} />
          </span>
        )}
      </span>
      {round.run.title && (
        <span {...stylex.props(styles.secondary, styles.wrap)}>{round.run.title}</span>
      )}
      <span {...stylex.props(styles.line)}>
        <span {...stylex.props(styles.state, styles[meta.tone])}>
          {meta.icon && <Icon icon={meta.icon} size={14} spin={meta.spin} />}
          {meta.label}
        </span>
        {state === 'toReview' && total > 0 && (
          <span {...stylex.props(styles.tertiary)}>
            {t('acceptance.roundState.summary', { accepted, total })}
          </span>
        )}
      </span>
      {reason && <span {...stylex.props(styles.secondary, styles.wrap)}>{reason}</span>}
      {total > 0 && (
        <DecisionStrip
          label={t('acceptance.bar.stripLabel', { accepted, total })}
          segments={segments}
          xstyle={styles.strip}
        />
      )}
    </>
  );

  if (!openable) return <div {...stylex.props(styles.card, active && styles.active)}>{body}</div>;

  return (
    <button
      title={t('acceptance.ledger.viewReport')}
      type={'button'}
      {...stylex.props(styles.card, styles.openable, active && styles.active)}
      onClick={() => onOpen(round)}
    >
      {body}
    </button>
  );
});

RoundCard.displayName = 'AcceptanceRoundCard';

export default RoundCard;
