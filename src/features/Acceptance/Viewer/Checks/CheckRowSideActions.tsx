import { Button, Icon } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { Check, MessageSquare, MessageSquareX } from 'lucide-react';
import type { ReactNode } from 'react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { styles } from './styles';
import type { CheckReviewActions } from './useCheckReviewActions';

interface CheckRowSideActionsProps {
  /** Lay out as one line at every width — the verdict bar under a list row. */
  inline?: boolean;
  /** Extra quiet links beside the comment entry (history, trace). */
  leading?: ReactNode;
  onCommentEvidence?: () => void;
  review: CheckReviewActions;
  reviewPending: boolean;
  showDecision: boolean;
}

export const CheckRowSideActions = memo<CheckRowSideActionsProps>(
  ({ inline, leading, onCommentEvidence, review, reviewPending, showDecision }) => {
    const { t } = useTranslation('verify');
    const { accepting, handleAccept, handleIgnore, ignoring, openReject } = review;

    const commentButton = onCommentEvidence ? (
      <Button
        outdent
        icon={<Icon icon={MessageSquare} />}
        style={{ alignSelf: inline ? undefined : 'flex-start' }}
        type={'text'}
        onClick={(event) => {
          event.stopPropagation();
          onCommentEvidence();
        }}
      >
        {t('acceptance.comments.evidenceModalTitle')}
      </Button>
    ) : null;

    return (
      <div {...stylex.props(styles.sideActions, inline && styles.sideActionsInline)}>
        {inline ? (
          <div {...stylex.props(styles.sideActionsLeading)}>
            {commentButton}
            {leading}
          </div>
        ) : (
          (commentButton ?? <span />)
        )}
        {showDecision && (
          <div {...stylex.props(styles.decisionStack, inline && styles.decisionStackInline)}>
            <Button
              disabled={reviewPending && !accepting}
              icon={<Icon icon={Check} />}
              loading={accepting}
              type={'primary'}
              onClick={handleAccept}
            >
              {t('acceptance.review.accept')}
            </Button>
            <Button
              disabled={reviewPending}
              icon={<Icon icon={MessageSquareX} />}
              onClick={(event) => {
                event.stopPropagation();
                openReject();
              }}
            >
              {t('acceptance.review.reject')}
            </Button>
            <Button
              disabled={reviewPending && !ignoring}
              loading={ignoring}
              type={'text'}
              onClick={handleIgnore}
            >
              {t('acceptance.review.ignore')}
            </Button>
          </div>
        )}
      </div>
    );
  },
);

CheckRowSideActions.displayName = 'AcceptanceCheckRowSideActions';
