import { Alert } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

interface BulkDeleteConfirmContentProps {
  /** Selected tasks. */
  count: number;
  /** How many of them another workspace member created. */
  othersCount: number;
}

/**
 * Body of the batch delete confirmation. Deleting a teammate's task is allowed
 * (as for a single task), but in a batch it is easy to miss, so a selection
 * that includes any gets an explicit warning with the count.
 */
const BulkDeleteConfirmContent = memo<BulkDeleteConfirmContentProps>(({ count, othersCount }) => {
  const { t } = useTranslation('chat');
  return (
    <>
      <div>{t('taskList.bulk.deleteConfirm.content', { count })}</div>
      {othersCount > 0 && (
        <Alert
          data-testid={'task-bulk-delete-others-warning'}
          style={{ marginTop: 12 }}
          title={t('taskList.bulk.deleteConfirm.othersWarning', { count: othersCount })}
          type={'warning'}
        />
      )}
    </>
  );
});

BulkDeleteConfirmContent.displayName = 'BulkDeleteConfirmContent';

export default BulkDeleteConfirmContent;
