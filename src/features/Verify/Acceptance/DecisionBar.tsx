'use client';

import { Flexbox, Icon, Text } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { BadgeCheck, HelpCircle, ListTodo, Loader2, RotateCcw } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

const styles = createStaticStyles(({ css }) => ({
  /* Floats over the scrolling checklist — the decision stays reachable
     however deep the review goes. */
  bar: css`
    position: sticky;
    z-index: 20;
    inset-block-end: 16px;

    display: flex;
    gap: 12px;
    align-items: center;

    padding-block: 10px;
    padding-inline: 14px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};

    background: ${cssVar.colorBgElevated};
    box-shadow: ${cssVar.boxShadowTertiary};
  `,
  feedbackChip: css`
    white-space: nowrap;
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
      accepted: { color: cssVar.colorSuccess, icon: BadgeCheck, spin: false },
      live: { color: cssVar.colorInfo, icon: Loader2, spin: true },
      rejected: { color: cssVar.colorError, icon: RotateCcw, spin: false },
      settled: {
        color: hasException ? cssVar.colorWarning : cssVar.colorSuccess,
        icon: hasException ? HelpCircle : BadgeCheck,
        spin: false,
      },
    }[state];

    return (
      <div className={styles.bar}>
        <Icon color={stateMeta.color} icon={stateMeta.icon} size={18} spin={stateMeta.spin} />
        <Flexbox gap={1} style={{ flex: 1, minWidth: 0 }}>
          <Text strong style={{ fontSize: 14, whiteSpace: 'nowrap' }}>
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
            className={styles.feedbackChip}
            icon={<Icon icon={ListTodo} />}
            size={'small'}
            type={'text'}
            onClick={onOpenFeedback}
          >
            {t('acceptance.bar.feedback', { count: feedbackCount })}
          </Button>
        )}

        {state === 'settled' && (
          <Button disabled={pending} type={'primary'} onClick={onAccept}>
            {t('acceptance.actions.accept')}
          </Button>
        )}
      </div>
    );
  },
);

DecisionBar.displayName = 'AcceptanceDecisionBar';

export default DecisionBar;
