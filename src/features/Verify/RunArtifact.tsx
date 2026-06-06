import { Flexbox, Icon } from '@lobehub/ui';
import { createStyles } from 'antd-style';
import { Check, Info, PackageCheck, RefreshCw, Shield, X } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useVerifyResults, useVerifyState } from './hooks';
import { countResults, type DockPhase, phaseFromStatus } from './utils';

const useStyles = createStyles(({ css, token }) => ({
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
  kicker: css`
    margin-block-end: 4px;
    font-size: 12px;
    font-weight: 600;
    color: ${token.colorTextTertiary};
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
  key: 'pending' | 'failed' | 'repairing' | 'passed';
}

const phaseToArtifact: Record<DockPhase, { badge: BadgeMeta; subKey: string } | null> = {
  draft: null,
  failed: {
    badge: { color: 'error', icon: X, key: 'failed' },
    subKey: 'artifact.failed.sub',
  },
  idle: {
    badge: { color: 'default', icon: Shield, key: 'pending' },
    subKey: 'artifact.pending.sub',
  },
  passed: {
    badge: { color: 'success', icon: Check, key: 'passed' },
    subKey: 'artifact.passed.sub',
  },
  repairing: {
    badge: { color: 'warning', icon: RefreshCw, key: 'repairing' },
    subKey: 'artifact.repairing.sub',
  },
  verifying: {
    badge: { color: 'default', icon: Shield, key: 'pending' },
    subKey: 'artifact.pending.sub',
  },
};

interface RunArtifactProps {
  /** Render only the header (kicker + title + status), no card chrome — for the merged verify card. */
  embedded?: boolean;
  operationId: string;
  /** Display round number (1-based); repair rounds are separate operations. */
  round?: number;
}

/**
 * Inline snapshot card for one Agent Run's verify outcome. Rendered in the chat
 * thread below the assistant message group. Each round (operation) keeps its own
 * artifact, so failed snapshots are never overwritten by later success.
 */
const RunArtifact = memo<RunArtifactProps>(({ operationId, round = 1, embedded }) => {
  const { styles, cx, theme } = useStyles();
  const { t } = useTranslation('verify');
  const { data: state } = useVerifyState(operationId);
  const { data: results } = useVerifyResults(operationId);

  const phase = phaseFromStatus(state?.verifyStatus);
  const meta = phaseToArtifact[phase];
  if (!state?.verifyPlan?.length || !meta) return null;

  const counts = countResults(results ?? []);
  const titleKey = phase === 'passed' ? 'artifact.passed.title' : 'artifact.failed.title';
  const badgeColorMap = {
    default: theme.colorTextTertiary,
    error: theme.colorError,
    success: theme.colorSuccess,
    warning: theme.colorWarning,
  } as const;

  const header = (
    <div className={styles.head}>
      <Flexbox>
        <Flexbox horizontal align="center" className={styles.kicker} gap={6}>
          <Icon icon={PackageCheck} size={14} />
          {t('artifact.kicker', { round })}
        </Flexbox>
        <div className={styles.title}>{t(titleKey as any)}</div>
        <div className={styles.sub}>
          {t(meta.subKey as any, { passed: counts.passed, total: counts.total } as any)}
        </div>
      </Flexbox>
      <Flexbox
        horizontal
        align="center"
        gap={5}
        style={{ color: badgeColorMap[meta.badge.color], fontSize: 12, fontWeight: 600 }}
      >
        <Icon icon={meta.badge.icon} size={14} />
        {t(`badge.${meta.badge.key}` as any)}
      </Flexbox>
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
        <span>{t('artifact.foot')}</span>
      </div>
    </div>
  );
});

RunArtifact.displayName = 'RunArtifact';

export default RunArtifact;
