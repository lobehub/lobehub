'use client';

import { Flexbox, Icon, Text } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { BadgeCheck, HelpCircle, ListTodo, Loader2, RotateCcw } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

const styles = createStaticStyles(({ css }) => ({
  /* Floats over the scrolling checklist — the decision stays reachable
     however deep the review goes. A tinted left rail carries the state colour
     so the strip reads at a glance without shouting a full coloured fill. */
  bar: css`
    position: sticky;
    z-index: 20;
    inset-block-end: 16px;

    overflow: hidden;
    display: flex;
    gap: 14px;
    align-items: center;

    padding-block: 12px;
    padding-inline: 18px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 14px;

    background: ${cssVar.colorBgElevated};
    box-shadow: ${cssVar.boxShadowSecondary};
  `,
  /* The status glyph in a soft tinted disc — quieter than a bare coloured icon. */
  glyph: css`
    display: flex;
    flex: none;
    align-items: center;
    justify-content: center;

    width: 34px;
    height: 34px;
    border-radius: 50%;
  `,
  rail: css`
    position: absolute;
    inset-block: 0;
    inset-inline-start: 0;
    width: 4px;
  `,
}));

type BarState = 'accepted' | 'live' | 'rejected' | 'settled';

interface DecisionBarProps {
  /** Active (not-yet-consumed) feedback recorded this round. */
  feedbackCount: number;
  /** Exceptions (failed / uncertain) in the current union — colors the settled text. */
  hasException: boolean;
  onAccept: () => void;
  onOpenFeedback: () => void;
  pending: boolean;
  state: BarState;
  /** The state line, prepared by the page (status + counts wording). */
  statusText: string;
  subText?: string;
}

/**
 * The floating decision strip (P-12): the round chain's state, the feedback
 * clearing-list opener, and the closing accept. Whole-delivery feedback is
 * NOT an inline input here — feedback is left per-check / per-group where the
 * evidence is; the bar stays a decision surface, not a compose box.
 */
const DecisionBar = memo<DecisionBarProps>(
  ({
    feedbackCount,
    hasException,
    onAccept,
    onOpenFeedback,
    pending,
    state,
    statusText,
    subText,
  }) => {
    const { t } = useTranslation('verify');

    const stateMeta = {
      accepted: { bg: cssVar.colorSuccessBg, color: cssVar.colorSuccess, icon: BadgeCheck },
      live: { bg: cssVar.colorInfoBg, color: cssVar.colorInfo, icon: Loader2 },
      rejected: { bg: cssVar.colorErrorBg, color: cssVar.colorError, icon: RotateCcw },
      settled: hasException
        ? { bg: cssVar.colorWarningBg, color: cssVar.colorWarning, icon: HelpCircle }
        : { bg: cssVar.colorSuccessBg, color: cssVar.colorSuccess, icon: BadgeCheck },
    }[state];

    return (
      <div className={styles.bar}>
        <span className={styles.rail} style={{ background: stateMeta.color }} />
        <div className={styles.glyph} style={{ background: stateMeta.bg }}>
          <Icon color={stateMeta.color} icon={stateMeta.icon} size={18} spin={state === 'live'} />
        </div>
        <Flexbox gap={2} style={{ flex: 1, minWidth: 0 }}>
          <Text ellipsis strong style={{ fontSize: 14 }}>
            {statusText}
          </Text>
          {subText && (
            <Text ellipsis fontSize={12} type={'secondary'}>
              {subText}
            </Text>
          )}
        </Flexbox>

        {/* The clearing list — every note this round queues for the next one. */}
        {feedbackCount > 0 && (
          <Button
            icon={<Icon icon={ListTodo} />}
            size={'small'}
            style={{ flex: 'none' }}
            type={'fill'}
            onClick={onOpenFeedback}
          >
            {t('acceptance.bar.feedback', { count: feedbackCount })}
          </Button>
        )}

        {state === 'settled' && (
          <Button disabled={pending} style={{ flex: 'none' }} type={'primary'} onClick={onAccept}>
            {t('acceptance.actions.accept')}
          </Button>
        )}
      </div>
    );
  },
);

DecisionBar.displayName = 'AcceptanceDecisionBar';

export default DecisionBar;
