import type { ButtonProps } from '@lobehub/ui';
import { Button, Flexbox, Icon } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { MessageSquarePlus } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { decisionBarStyles as styles } from './decisionBarStyles';
import type { DecisionBarState } from './DecisionMarks';

const ActionButton = (props: ButtonProps) => (
  <Button {...props} {...stylex.props(styles.actionButton)} />
);

interface DecisionActionsProps {
  allConfirmed: boolean;
  embedded?: boolean;
  hasFeedback: boolean;
  onAccept: () => void;
  onAddComment: () => void;
  onCopyReview: () => void;
  onRejectComment: () => void;
  onRerun: () => void;
  pending: boolean;
  readOnlyReason?: string;
  rejectOnlyReason?: string;
  rerunAvailable: boolean;
  rerunPending: boolean;
  state: DecisionBarState;
}

export const DecisionActions = ({
  allConfirmed,
  embedded,
  hasFeedback,
  onAccept,
  onAddComment,
  onCopyReview,
  onRejectComment,
  onRerun,
  pending,
  readOnlyReason,
  rejectOnlyReason,
  rerunAvailable,
  rerunPending,
  state,
}: DecisionActionsProps) => {
  const { t } = useTranslation('verify');

  if (readOnlyReason) {
    // Not this viewer's call: the decision they are waiting on stays in view,
    // disabled, so the bar says who decides instead of vanishing.
    if (state !== 'settled') return null;
    return (
      <Flexbox horizontal gap={8} {...stylex.props(styles.actions)}>
        <ActionButton disabled title={readOnlyReason} type={'text'}>
          {t('acceptance.bar.rejectComment')}
        </ActionButton>
        <ActionButton disabled title={readOnlyReason} type={'fill'}>
          {t('acceptance.actions.accept')}
        </ActionButton>
      </Flexbox>
    );
  }

  if (rejectOnlyReason) {
    if (state !== 'settled') return null;
    return (
      <Flexbox horizontal gap={8} {...stylex.props(styles.actions)}>
        <ActionButton disabled={pending} type={'fill'} onClick={onRejectComment}>
          {t('acceptance.bar.rejectComment')}
        </ActionButton>
        <ActionButton disabled title={rejectOnlyReason} type={'fill'}>
          {t('acceptance.actions.accept')}
        </ActionButton>
      </Flexbox>
    );
  }

  const repairHandoff = hasFeedback || state === 'rejected';

  return (
    <Flexbox horizontal gap={8} {...stylex.props(styles.actions)}>
      {/* A dispatched send-back keeps the copy entry alive: the reviewer may
          still hand the prompt to another agent. Embedded, the composer beside
          the bar already receives the draft. */}
      {state === 'live' && hasFeedback && !embedded && (
        <ActionButton disabled={pending} type={'fill'} onClick={onCopyReview}>
          {t('acceptance.bar.copyReview')}
        </ActionButton>
      )}

      {(state === 'settled' || state === 'rejected') &&
        (repairHandoff ? (
          <>
            <ActionButton
              disabled={pending}
              icon={<Icon icon={MessageSquarePlus} />}
              type={'fill'}
              onClick={onAddComment}
            >
              {t('acceptance.bar.addComment')}
            </ActionButton>
            {(!embedded || rerunAvailable) && (
              <ActionButton
                disabled={pending}
                loading={embedded && rerunPending}
                type={'primary'}
                onClick={embedded ? onRerun : onCopyReview}
              >
                {t(embedded ? 'acceptance.bar.rerun' : 'acceptance.bar.copyReview')}
              </ActionButton>
            )}
          </>
        ) : (
          <>
            <ActionButton disabled={pending} type={'text'} onClick={onRejectComment}>
              {t('acceptance.bar.rejectComment')}
            </ActionButton>
            <ActionButton
              disabled={pending}
              type={allConfirmed ? 'primary' : 'fill'}
              onClick={onAccept}
            >
              {t('acceptance.actions.accept')}
            </ActionButton>
          </>
        ))}
    </Flexbox>
  );
};
