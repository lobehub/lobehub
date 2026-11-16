import { Button, Flexbox, Text } from '@lobehub/ui';
import { useTranslation } from 'react-i18next';

import type { FlowNodeState } from './flow';
import { type CheckVerdict, useCheckReview } from './useCheckReview';

interface ReviewActionsProps {
  boardId: string;
  compact?: boolean;
  onReviewed?: (verdict: CheckVerdict) => void;
  state: FlowNodeState;
}

const ReviewActions = ({ boardId, compact, onReviewed, state }: ReviewActionsProps) => {
  const { t } = useTranslation('project');
  const { canReview, review, saving, submit } = useCheckReview(boardId);
  if (!canReview) return null;

  if (review)
    return (
      <Text style={{ fontSize: compact ? 12 : undefined }} type={compact ? 'secondary' : undefined}>
        {t(
          review === 'accepted'
            ? 'artboard.verify.reviewAccepted'
            : 'artboard.verify.reviewRejected',
        )}
      </Text>
    );

  const act = async (verdict: CheckVerdict) => {
    if (await submit(verdict)) onReviewed?.(verdict);
  };
  const size = compact ? 'small' : undefined;
  return (
    <Flexbox horizontal gap={8} onClick={(event) => event.stopPropagation()}>
      <Button
        loading={saving}
        size={size}
        type={compact ? 'default' : 'primary'}
        onClick={() => act('accepted')}
      >
        {t('artboard.verify.accept')}
      </Button>
      <Button danger loading={saving} size={size} onClick={() => act('rejected')}>
        {t(state === 'failed' ? 'artboard.verify.rejectFailed' : 'artboard.verify.reject')}
      </Button>
    </Flexbox>
  );
};

export default ReviewActions;
