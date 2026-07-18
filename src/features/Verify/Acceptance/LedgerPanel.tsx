'use client';

import { ActionIcon, Flexbox, Icon, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import dayjs from 'dayjs';
import {
  CheckCircle2,
  ChevronRight,
  Circle,
  CircleAlert,
  FileClock,
  Loader2,
  PanelRightClose,
  RefreshCw,
} from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { AcceptanceBundle } from '@/services/verify';

export type AcceptanceRound = AcceptanceBundle['rounds'][number];

/** Per-round acceptance tally (how many of the round's own checks the user signed off). */
export interface RoundReview {
  accepted: number;
  total: number;
}

const styles = createStaticStyles(({ css }) => ({
  countBadge: css`
    padding-block: 1px;
    padding-inline: 7px;
    border-radius: 99px;

    font-size: 12px;
    font-variant-numeric: tabular-nums;
    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorFillTertiary};
  `,
  round: css`
    padding-block: 10px;
    padding-inline: 12px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadius};

    transition:
      box-shadow 0.2s ease,
      border-color 0.2s ease;
  `,
  roundActive: css`
    border-color: ${cssVar.colorPrimary};
    box-shadow: 0 0 0 2px ${cssVar.colorPrimaryBg};
  `,
  /* The whole card is the report affordance — no inner button. */
  roundClickable: css`
    cursor: pointer;

    .acceptance-round-open-hint {
      opacity: 0;
      transition: opacity 0.2s ease;
    }

    &:hover {
      border-color: ${cssVar.colorBorder};
      background: ${cssVar.colorFillQuaternary};

      .acceptance-round-open-hint {
        opacity: 1;
      }
    }
  `,
}));

/** Only the still-running states keep a machine indicator; a settled round is
    reframed as an ACCEPTANCE state (已验收 / 待验收), not a verification verdict. */
const RUNNING_META: Record<string, { color: string; icon: typeof CheckCircle2 }> = {
  errored: { color: cssVar.colorWarning, icon: CircleAlert },
  repairing: { color: cssVar.colorWarning, icon: RefreshCw },
  verifying: { color: cssVar.colorInfo, icon: Loader2 },
};

/** Is the round still executing (so it has no settled result to accept yet)? */
const isRunningRound = (round: AcceptanceRound): boolean => {
  const status = round.run.status;
  if (status === 'verifying' || status === 'repairing' || status === 'errored') return true;
  // No report yet and no terminal status → still spinning up.
  return !round.report && status !== 'passed' && status !== 'failed';
};

interface LedgerPanelProps {
  /** The hosting surface already provides a close affordance (narrow-mode
      Drawer) — a second collapse icon here would read as two closes. */
  hideCollapse?: boolean;
  highlight: number | null;
  onCollapse: () => void;
  onOpenReport: (round: AcceptanceRound) => void;
  /** Per-round acceptance tally, keyed by round index (the round's own checks). */
  reviewByRound: Map<number, RoundReview>;
  rounds: AcceptanceRound[];
}

/**
 * The execution history, demoted to an audit side panel (P-13). Each row is a
 * round; the state it reports is the user's ACCEPTANCE progress on that round's
 * checks (已验收 / 待验收), not the raw verification verdict — the panel speaks
 * the same acceptance language as the checklist.
 */
const LedgerPanel = memo<LedgerPanelProps>(
  ({ hideCollapse, highlight, onCollapse, onOpenReport, reviewByRound, rounds }) => {
    const { t } = useTranslation('verify');
    const latestIndex = rounds.at(-1)?.run.roundIndex;

    return (
      <Flexbox gap={12} padding={16}>
        <Flexbox horizontal align={'center'} gap={8}>
          <Icon color={cssVar.colorTextSecondary} icon={FileClock} size={16} />
          <Text strong style={{ fontSize: 13 }}>
            {t('acceptance.ledger.title')}
          </Text>
          <span className={styles.countBadge}>{rounds.length}</span>
          <Flexbox flex={1} />
          {!hideCollapse && (
            <ActionIcon
              icon={PanelRightClose}
              size={'small'}
              title={t('acceptance.ledger.collapse')}
              onClick={onCollapse}
            />
          )}
        </Flexbox>
        {[...rounds].reverse().map((round) => {
          const running = isRunningRound(round);
          const runStatus = round.run.status ?? 'verifying';
          const runningMeta = running ? (RUNNING_META[runStatus] ?? RUNNING_META.verifying) : null;
          const rv =
            round.run.roundIndex != null ? reviewByRound.get(round.run.roundIndex) : undefined;
          const total = rv?.total ?? 0;
          const accepted = rv?.accepted ?? 0;
          const allAccepted = total > 0 && accepted >= total;

          const stateColor = runningMeta
            ? runningMeta.color
            : allAccepted
              ? cssVar.colorSuccess
              : cssVar.colorTextTertiary;
          const stateIcon = runningMeta ? runningMeta.icon : allAccepted ? CheckCircle2 : Circle;
          const stateLabel = runningMeta
            ? t(`acceptance.roundStatus.${runStatus}` as 'acceptance.roundStatus.verifying', {
                defaultValue: runStatus,
              })
            : allAccepted
              ? t('acceptance.ledger.accepted')
              : t('acceptance.ledger.pending');

          // Acceptance-framed stats: how many of THIS round's checks are signed
          // off (accepted/total), or all still awaiting.
          const stats =
            running || total === 0
              ? null
              : accepted > 0
                ? t('acceptance.ledger.acceptedStats', { accepted, total })
                : t('acceptance.ledger.awaitingStats', { total });

          const openable = Boolean(round.report);

          return (
            <Flexbox
              aria-label={openable ? t('acceptance.ledger.viewReport') : undefined}
              gap={6}
              key={round.run.id}
              role={openable ? 'button' : undefined}
              className={cx(
                styles.round,
                openable && styles.roundClickable,
                highlight === round.run.roundIndex && styles.roundActive,
              )}
              onClick={openable ? () => onOpenReport(round) : undefined}
            >
              <Flexbox horizontal align={'center'} gap={8}>
                <Text strong style={{ fontSize: 13 }}>
                  {t('acceptance.round', { round: round.run.roundIndex })}
                </Text>
                {round.run.roundIndex === latestIndex && (
                  <Text fontSize={12} type={'secondary'}>
                    {t('acceptance.ledger.latest')}
                  </Text>
                )}
                <Flexbox
                  horizontal
                  align={'center'}
                  gap={4}
                  style={{ color: stateColor, fontSize: 12 }}
                >
                  <Icon icon={stateIcon} size={13} spin={running} />
                  {stateLabel}
                </Flexbox>
                <Flexbox flex={1} />
                <Text fontSize={12} type={'secondary'}>
                  {dayjs(round.run.createdAt).format('MM-DD HH:mm')}
                </Text>
                {openable && (
                  <Icon
                    className={'acceptance-round-open-hint'}
                    color={cssVar.colorTextTertiary}
                    icon={ChevronRight}
                    size={14}
                  />
                )}
              </Flexbox>
              {round.run.title && (
                <Text fontSize={12} style={{ lineHeight: 1.5 }} type={'secondary'}>
                  {round.run.title}
                </Text>
              )}
              {stats && (
                <Text fontSize={12} type={'secondary'}>
                  {stats}
                </Text>
              )}
            </Flexbox>
          );
        })}
      </Flexbox>
    );
  },
);

LedgerPanel.displayName = 'AcceptanceLedgerPanel';

export default LedgerPanel;
