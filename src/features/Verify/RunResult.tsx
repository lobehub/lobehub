import { Flexbox, Icon } from '@lobehub/ui';
import { createStyles } from 'antd-style';
import { Check, Info, RefreshCw, Shield, ShieldCheck, X } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useVerifyResults, useVerifyState } from './hooks';
import { countResults, type DockPhase, phaseFromStatus } from './utils';

const useStyles = createStyles(({ css, token }) => ({
  badge: css`
    display: inline-flex;
    flex: none;
    gap: 5px;
    align-items: center;

    padding-block: 4px;
    padding-inline: 10px;
    border-radius: 999px;

    font-size: 12px;
    font-weight: 600;
  `,
  body: css`
    padding-block: 12px;
    padding-inline: 16px;

    font-size: 13px;
    line-height: 1.7;
    color: ${token.colorTextSecondary};
  `,
  card: css`
    overflow: hidden;
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: 16px;
    background: ${token.colorBgContainer};
  `,
  cardFailed: css`
    border-color: ${token.colorErrorBorder};
  `,
  foot: css`
    display: flex;
    gap: 8px;
    align-items: center;

    padding-block: 10px;
    padding-inline: 16px;
    border-block-start: 1px solid ${token.colorBorderSecondary};

    font-size: 12px;
    color: ${token.colorTextTertiary};
  `,
  head: css`
    display: flex;
    gap: 14px;
    align-items: flex-start;
    justify-content: space-between;

    padding-block: 14px;
    padding-inline: 16px;
    border-block-end: 1px solid ${token.colorBorderSecondary};
  `,
  sub: css`
    margin-block-start: 4px;
    font-size: 12px;
    line-height: 1.5;
    color: ${token.colorTextTertiary};
  `,
  title: css`
    font-size: 15px;
    font-weight: 700;
    color: ${token.colorText};
  `,
}));

interface BadgeMeta {
  color: 'default' | 'success' | 'error' | 'warning';
  icon: typeof Check;
  key: 'pending' | 'failed' | 'errored' | 'repairing' | 'passed';
}

const phaseToResult: Record<DockPhase, { badge: BadgeMeta; subKey: string } | null> = {
  draft: {
    badge: { color: 'default', icon: Shield, key: 'pending' },
    subKey: 'result.pending.sub',
  },
  errored: {
    // Warning, not error: the verifier couldn't run, so the delivery was never
    // judged — never render it as a failed check.
    badge: { color: 'warning', icon: Info, key: 'errored' },
    subKey: 'result.errored.sub',
  },
  failed: {
    badge: { color: 'error', icon: X, key: 'failed' },
    subKey: 'result.failed.sub',
  },
  idle: {
    badge: { color: 'default', icon: Shield, key: 'pending' },
    subKey: 'result.pending.sub',
  },
  passed: {
    badge: { color: 'success', icon: Check, key: 'passed' },
    subKey: 'result.passed.sub',
  },
  repairing: {
    badge: { color: 'warning', icon: RefreshCw, key: 'repairing' },
    subKey: 'result.repairing.sub',
  },
  verifying: {
    badge: { color: 'default', icon: Shield, key: 'pending' },
    subKey: 'result.pending.sub',
  },
};

interface RunResultProps {
  /** Render only the header (kicker + title + status), no card chrome — for the merged verify card. */
  embedded?: boolean;
  operationId: string;
  /** Display round number (1-based); repair rounds are separate operations. */
  round?: number;
}

/**
 * Inline snapshot card for one Agent Run's verify outcome. Rendered in the chat
 * thread below the assistant message group. Each round (operation) keeps its own
 * result snapshot, so failures are never overwritten by later success.
 */
const RunResult = memo<RunResultProps>(({ operationId, round = 1, embedded }) => {
  const { styles, cx, theme } = useStyles();
  const { t } = useTranslation('verify');
  const { data: state } = useVerifyState(operationId);
  const { data: results } = useVerifyResults(operationId);

  const phase = phaseFromStatus(state?.verifyStatus);
  const meta = phaseToResult[phase];
  if (!state?.verifyPlan?.length || !meta) return null;

  const counts = countResults(results ?? []);
  const badgeColorMap = {
    default: theme.colorTextTertiary,
    error: theme.colorError,
    success: theme.colorSuccess,
    warning: theme.colorWarning,
  } as const;
  // Deeper, more readable text color over the tinted badge fill.
  const badgeTextMap = {
    default: theme.colorTextSecondary,
    error: theme.colorErrorTextActive,
    success: theme.colorSuccessTextActive,
    warning: theme.colorWarningTextActive,
  } as const;

  const header = (
    <div className={styles.head}>
      <Flexbox>
        <Flexbox horizontal align="center" gap={7}>
          <Icon icon={ShieldCheck} size={16} />
          <span className={styles.title}>{t('result.title', { round })}</span>
        </Flexbox>
        <div className={styles.sub}>
          {t(meta.subKey as any, { passed: counts.passed, total: counts.total } as any)}
        </div>
      </Flexbox>
      <span
        className={styles.badge}
        style={{
          background: `color-mix(in srgb, ${badgeColorMap[meta.badge.color]} 12%, transparent)`,
          color: badgeTextMap[meta.badge.color],
        }}
      >
        <Icon icon={meta.badge.icon} size={14} />
        {t(`badge.${meta.badge.key}` as any)}
      </span>
    </div>
  );

  // Merged verify card: header only, no card chrome / summary list / footer.
  if (embedded) return header;

  return (
    <div className={cx(styles.card, phase === 'failed' && styles.cardFailed)}>
      {header}
      <div className={styles.body}>
        <Flexbox gap={4}>
          {(state.verifyPlan ?? []).map((item) => {
            const result = (results ?? []).find((r) => r.checkItemId === item.id);
            return (
              <Flexbox horizontal align="center" gap={8} key={item.id}>
                <span>{item.title}</span>
                {result?.verdict && (
                  <span
                    style={{
                      color: badgeColorMap[result.verdict === 'passed' ? 'success' : 'error'],
                    }}
                  >
                    · {result.verdict}
                  </span>
                )}
              </Flexbox>
            );
          })}
        </Flexbox>
      </div>
      <div className={styles.foot}>
        <Icon icon={Info} size={14} />
        <span>{t('result.foot')}</span>
      </div>
    </div>
  );
});

RunResult.displayName = 'RunResult';

export default RunResult;
