import { Button, Icon } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import dayjs from 'dayjs';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useIsHydrated } from '@/hooks/useIsHydrated';

import type { CheckDecision } from './checkDecision';
import { DECISION_ICON, DECISION_LABEL_KEY } from './checkDecision';
import { FeedbackCard } from './CheckHistory';
import type { AcceptanceCheckReviewEntry, AcceptanceEvidence } from './types';

const styles = stylex.create({
  record: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    paddingBlockStart: '12px',
    borderBlockStartWidth: '1px',
    borderBlockStartStyle: 'solid',
    borderBlockStartColor: cssVar.colorBorderSecondary,
  },
  head: {
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
  },
  label: {
    display: 'inline-flex',
    gap: '4px',
    alignItems: 'center',
    fontSize: '12px',
    fontWeight: 500,
    lineHeight: '20px',
    color: cssVar.colorTextSecondary,
  },
  accepted: { color: cssVar.colorSuccessText },
  needsFix: { color: cssVar.colorErrorText },
  time: {
    fontSize: '12px',
    fontVariantNumeric: 'tabular-nums',
    lineHeight: '20px',
    color: cssVar.colorTextTertiary,
  },
  undo: {
    display: 'flex',
    gap: '16px',
    alignItems: 'center',
  },
});

const REVIEW_DECISION = {
  accept: 'accepted',
  ignore: 'ignored',
  reject: 'needsFix',
} as const satisfies Record<AcceptanceCheckReviewEntry['action'], CheckDecision>;

interface StandingDecisionProps {
  accepting: boolean;
  evidenceById: Map<string, AcceptanceEvidence>;
  onAccept?: (event: { stopPropagation: () => void }) => void;
  onReject?: () => void;
  review: AcceptanceCheckReviewEntry;
  reviewPending: boolean;
}

const StandingDecision = memo<StandingDecisionProps>(
  ({ accepting, evidenceById, onAccept, onReject, review, reviewPending }) => {
    const { t } = useTranslation('verify');
    const hydrated = useIsHydrated();
    const decision = REVIEW_DECISION[review.action];
    const DecisionIcon = DECISION_ICON[decision];
    const canAccept = Boolean(onAccept) && review.action !== 'accept';
    const canReject = Boolean(onReject) && review.action !== 'reject';

    return (
      <div data-standing-decision={decision} {...stylex.props(styles.record)}>
        <div {...stylex.props(styles.head)}>
          <span
            {...stylex.props(
              styles.label,
              decision === 'accepted' && styles.accepted,
              decision === 'needsFix' && styles.needsFix,
            )}
          >
            {DecisionIcon && <Icon icon={DecisionIcon} size={14} />}
            {t(DECISION_LABEL_KEY[decision])}
          </span>
          <span {...stylex.props(styles.time)}>
            {hydrated ? dayjs(review.createdAt).format('MM-DD HH:mm') : null}
          </span>
        </div>
        {review.action === 'reject' && (
          <FeedbackCard hideHeader evidenceById={evidenceById} review={review} />
        )}
        {(canAccept || canReject) && (
          <div {...stylex.props(styles.undo)}>
            {canReject && (
              <Button
                outdent
                disabled={reviewPending}
                size={'small'}
                type={'text'}
                onClick={(event) => {
                  event.stopPropagation();
                  onReject?.();
                }}
              >
                {t('acceptance.review.revertToReject')}
              </Button>
            )}
            {canAccept && (
              <Button
                outdent
                disabled={reviewPending && !accepting}
                loading={accepting}
                size={'small'}
                type={'text'}
                onClick={onAccept}
              >
                {t('acceptance.review.revertToAccept')}
              </Button>
            )}
          </div>
        )}
      </div>
    );
  },
);

StandingDecision.displayName = 'AcceptanceStandingDecision';

export default StandingDecision;
