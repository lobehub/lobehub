import { Alert } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import VisibilityConfirmContent from '@/features/VisibilityConfirmContent';

interface BulkAssignPrivateConfirmContentProps {
  /** Public tasks in the selection that go private first. */
  count: number;
  /** How many of them another workspace member created (taken over). */
  takeOverCount: number;
}

/**
 * Body of the confirmation shown before a batch is assigned to a private
 * agent: like the single-task picker, its public tasks go private first, and
 * a teammate's task is taken over as the caller's own, so that count is
 * called out on its own.
 */
const BulkAssignPrivateConfirmContent = memo<BulkAssignPrivateConfirmContentProps>(
  ({ count, takeOverCount }) => {
    const { t } = useTranslation('chat');
    return (
      <>
        <VisibilityConfirmContent variant="makePrivate" />
        <div style={{ marginTop: 8, opacity: 0.7 }}>
          {t('taskList.bulk.assignPrivate.hint', { count })}
        </div>
        {takeOverCount > 0 && (
          <Alert
            data-testid={'task-bulk-assign-private-takeover-warning'}
            style={{ marginTop: 12 }}
            title={t('taskList.bulk.assignPrivate.takeOverWarning', { count: takeOverCount })}
            type={'warning'}
          />
        )}
      </>
    );
  },
);

BulkAssignPrivateConfirmContent.displayName = 'BulkAssignPrivateConfirmContent';

export default BulkAssignPrivateConfirmContent;
