import { Flexbox, Icon } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { Info, Shield, ShieldAlert, ShieldCheck, ShieldX } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useVerifyResults, useVerifyState } from '../hooks';
import { countResults, type DockPhase, phaseFromStatus } from '../utils';

const styles = stylex.create({
  body: {
    paddingBlock: '12px',
    paddingInline: '16px',
    fontSize: '13px',
    lineHeight: 1.7,
    color: cssVar.colorTextSecondary,
  },
  card: {
    overflow: 'hidden',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: '16px',
    backgroundColor: cssVar.colorBgContainer,
    backgroundImage: 'none',
  },
  cardFailed: { borderColor: cssVar.colorErrorBorder },
  foot: {
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
    paddingBlock: '10px',
    paddingInline: '16px',
    borderBlockStartWidth: '1px',
    borderBlockStartStyle: 'solid',
    borderBlockStartColor: cssVar.colorBorderSecondary,
    fontSize: '12px',
    color: cssVar.colorTextTertiary,
  },
  head: {
    display: 'flex',
    gap: '14px',
    alignItems: 'flex-start',
    paddingBlock: '14px',
    paddingInline: '16px',
    borderBlockEndWidth: '1px',
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: cssVar.colorBorderSecondary,
  },
  status: { fontSize: '13px', fontWeight: 600 },
  sub: {
    marginBlockStart: '4px',
    fontSize: '12px',
    lineHeight: 1.5,
    color: cssVar.colorTextTertiary,
  },
  title: { fontSize: '15px', fontWeight: 700, color: cssVar.colorText },
});

interface BadgeMeta {
  color: 'default' | 'success' | 'error' | 'warning';
  /** Shield family only: the glyph is the block's identity AND its verdict. */
  icon: typeof Shield;
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
    badge: { color: 'warning', icon: ShieldAlert, key: 'errored' },
    subKey: 'result.errored.sub',
  },
  failed: {
    badge: { color: 'error', icon: ShieldX, key: 'failed' },
    subKey: 'result.failed.sub',
  },
  idle: {
    badge: { color: 'default', icon: Shield, key: 'pending' },
    subKey: 'result.pending.sub',
  },
  passed: {
    badge: { color: 'success', icon: ShieldCheck, key: 'passed' },
    subKey: 'result.passed.sub',
  },
  repairing: {
    badge: { color: 'warning', icon: ShieldAlert, key: 'repairing' },
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
  const { t } = useTranslation('verify');
  const { data: state } = useVerifyState(operationId);
  const { data: results } = useVerifyResults(operationId);

  const phase = phaseFromStatus(state?.verifyStatus);
  const meta = phaseToResult[phase];
  if (!state?.verifyPlan?.length || !meta) return null;

  const counts = countResults(results ?? []);
  const badgeColorMap = {
    default: cssVar.colorTextTertiary,
    error: cssVar.colorError,
    success: cssVar.colorSuccess,
    warning: cssVar.colorWarning,
  } as const;
  // Deeper, more readable text color over the tinted badge fill.
  const badgeTextMap = {
    default: cssVar.colorTextSecondary,
    error: cssVar.colorErrorTextActive,
    success: cssVar.colorSuccessTextActive,
    warning: cssVar.colorWarningTextActive,
  } as const;

  // The verdict lives IN the title: the shield changes form and colour with the
  // phase and the status text sits right after the round number, so the reader
  // never has to travel to the far edge of the card — a pill there read as a
  // separate control and left the title looking neutral on a failed round.
  const header = (
    <div {...stylex.props(styles.head)}>
      <Flexbox>
        <Flexbox horizontal align="center" gap={7}>
          <Icon
            color={meta.badge.color === 'default' ? undefined : badgeColorMap[meta.badge.color]}
            icon={meta.badge.icon}
            size={16}
          />
          <span {...stylex.props(styles.title)}>{t('result.title', { round })}</span>
          <span
            className={stylex.props(styles.status).className}
            style={{ color: badgeTextMap[meta.badge.color] }}
          >
            {t(`badge.${meta.badge.key}` as any)}
          </span>
        </Flexbox>
        <div {...stylex.props(styles.sub)}>
          {t(meta.subKey as any, { passed: counts.passed, total: counts.total } as any)}
        </div>
      </Flexbox>
    </div>
  );

  // Merged verify card: header only, no card chrome / summary list / footer.
  if (embedded) return header;

  return (
    <div {...stylex.props(styles.card, phase === 'failed' && styles.cardFailed)}>
      {header}
      <div {...stylex.props(styles.body)}>
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
      <div {...stylex.props(styles.foot)}>
        <Icon icon={Info} size={14} />
        <span>{t('result.foot')}</span>
      </div>
    </div>
  );
});

RunResult.displayName = 'RunResult';

export default RunResult;
