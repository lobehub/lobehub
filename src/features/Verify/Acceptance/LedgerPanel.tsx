'use client';

import { ActionIcon, Flexbox, Icon, Text } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import dayjs from 'dayjs';
import {
  CheckCircle2,
  CircleAlert,
  FileClock,
  FileText,
  HelpCircle,
  Loader2,
  PanelRightClose,
  Wrench,
  XCircle,
} from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { AcceptanceBundle } from '@/services/verify';

export type AcceptanceRound = AcceptanceBundle['rounds'][number];

const styles = createStaticStyles(({ css }) => ({
  round: css`
    padding-block: 10px;
    padding-inline: 12px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadius};

    transition: box-shadow 0.2s ease;
  `,
  roundActive: css`
    border-color: ${cssVar.colorPrimary};
    box-shadow: 0 0 0 2px ${cssVar.colorPrimaryBg};
  `,
}));

const STATUS_META: Record<string, { color: string; icon: typeof CheckCircle2 }> = {
  errored: { color: cssVar.colorWarning, icon: CircleAlert },
  failed: { color: cssVar.colorError, icon: XCircle },
  passed: { color: cssVar.colorSuccess, icon: CheckCircle2 },
  repairing: { color: cssVar.colorInfo, icon: Wrench },
  uncertain: { color: cssVar.colorWarning, icon: HelpCircle },
  verifying: { color: cssVar.colorInfo, icon: Loader2 },
};

/** The round's settled state for the ledger — report verdict beats a null rollup. */
const roundStatus = (round: AcceptanceRound): string => {
  const status = round.run.status;
  if (status === 'passed' || status === 'failed' || status === 'errored') return status;
  if (status === 'repairing' || status === 'verifying') return status;
  return round.report?.verdict ?? (round.report ? 'passed' : 'verifying');
};

interface LedgerPanelProps {
  highlight: number | null;
  onCollapse: () => void;
  onOpenReport: (round: AcceptanceRound) => void;
  rounds: AcceptanceRound[];
}

/**
 * The execution history, demoted to an audit side panel (P-13): each round is a
 * full verify run; the main list is the cross-round merge. Newest round first —
 * the latest attempt is the one under judgment.
 */
const LedgerPanel = memo<LedgerPanelProps>(({ highlight, onCollapse, onOpenReport, rounds }) => {
  const { t } = useTranslation('verify');
  const latestIndex = rounds.at(-1)?.run.roundIndex;

  return (
    <Flexbox gap={12} padding={16}>
      <Flexbox horizontal align={'center'} gap={8}>
        <Icon color={cssVar.colorTextSecondary} icon={FileClock} size={16} />
        <Text strong style={{ fontSize: 13 }}>
          {t('acceptance.ledger.title')}
        </Text>
        <Text fontSize={12} type={'secondary'}>
          {t('acceptance.ledger.count', { count: rounds.length })}
        </Text>
        <Flexbox flex={1} />
        <ActionIcon
          icon={PanelRightClose}
          size={'small'}
          title={t('acceptance.ledger.collapse')}
          onClick={onCollapse}
        />
      </Flexbox>
      <Text fontSize={12} type={'secondary'}>
        {t('acceptance.ledger.description')}
      </Text>
      {[...rounds].reverse().map((round) => {
        const status = roundStatus(round);
        const meta = STATUS_META[status] ?? STATUS_META.verifying;
        const stats =
          round.report?.totalChecks != null
            ? t('acceptance.ledger.stats', {
                passed: round.report.passedChecks ?? 0,
                total: round.report.totalChecks,
              })
            : null;
        const commit = (round.run.context as { commit?: string } | null)?.commit;

        return (
          <Flexbox
            className={cx(styles.round, highlight === round.run.roundIndex && styles.roundActive)}
            gap={6}
            key={round.run.id}
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
                style={{ color: meta.color, fontSize: 12 }}
              >
                <Icon icon={meta.icon} size={13} />
                {t(`acceptance.roundStatus.${status}`, { defaultValue: status })}
              </Flexbox>
              <Flexbox flex={1} />
              <Text fontSize={12} type={'secondary'}>
                {dayjs(round.run.createdAt).format('MM-DD HH:mm')}
              </Text>
            </Flexbox>
            {round.run.title && (
              <Text fontSize={12} style={{ lineHeight: 1.5 }} type={'secondary'}>
                {round.run.title}
              </Text>
            )}
            {(stats || commit) && (
              <Text fontSize={12} type={'secondary'}>
                {[stats, commit?.slice(0, 10)].filter(Boolean).join(' · ')}
              </Text>
            )}
            {round.report && (
              <Flexbox horizontal>
                <Button size={'small'} type={'text'} onClick={() => onOpenReport(round)}>
                  <Icon icon={FileText} size={13} /> {t('acceptance.ledger.viewReport')}
                </Button>
              </Flexbox>
            )}
          </Flexbox>
        );
      })}
    </Flexbox>
  );
});

LedgerPanel.displayName = 'AcceptanceLedgerPanel';

export default LedgerPanel;
