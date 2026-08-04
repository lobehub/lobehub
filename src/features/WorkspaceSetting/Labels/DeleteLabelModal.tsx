import { type AgentLabelListItem } from '@lobechat/types';
import { type ModalProps } from '@lobehub/ui';
import { Flexbox, Input, stopPropagation, Text } from '@lobehub/ui';
import { Button, toast } from '@lobehub/ui/base-ui';
import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import ImperativeModal from '@/components/ImperativeModal';
import { useHomeStore } from '@/store/home';

/** The word the user must type to arm the Delete button (mirrors Linear). */
const DELETE_CONFIRM_WORD = 'delete';

interface DeleteLabelModalProps extends Pick<ModalProps, 'open'> {
  label?: AgentLabelListItem;
  onClose: () => void;
}

/**
 * Destructive-delete confirm: deleting removes the label from every agent and
 * cannot be undone, so the modal requires typing `delete` and offers Archive
 * as the reversible alternative (mirrors the Linear flow in the issue spec).
 */
const DeleteLabelModal = memo<DeleteLabelModalProps>(({ label, open, onClose }) => {
  const { t } = useTranslation(['setting', 'common']);
  const [removeAgentLabel, updateAgentLabel] = useHomeStore((s) => [
    s.removeAgentLabel,
    s.updateAgentLabel,
  ]);

  const [confirmText, setConfirmText] = useState('');
  const [loading, setLoading] = useState(false);
  const [archiving, setArchiving] = useState(false);

  useEffect(() => {
    if (open) setConfirmText('');
  }, [open]);

  if (!label) return null;

  const armed = confirmText.trim().toLowerCase() === DELETE_CONFIRM_WORD;

  const handleDelete = async () => {
    if (!armed) return;
    setLoading(true);
    try {
      await removeAgentLabel(label.id);
      toast.success(t('workspaceSetting.labels.delete.success'));
      onClose();
    } catch (error) {
      console.error('Failed to delete label:', error);
      toast.error(t('operationFailed', { ns: 'common' }));
    } finally {
      setLoading(false);
    }
  };

  const handleArchive = async () => {
    setArchiving(true);
    try {
      await updateAgentLabel(label.id, { archived: true });
      toast.success(t('workspaceSetting.labels.archive.success'));
      onClose();
    } catch (error) {
      console.error('Failed to archive label:', error);
      toast.error(t('operationFailed', { ns: 'common' }));
    } finally {
      setArchiving(false);
    }
  };

  return (
    <div onClick={stopPropagation}>
      <ImperativeModal
        destroyOnHidden
        open={open}
        title={t('workspaceSetting.labels.delete.title', { name: label.name })}
        width={460}
        footer={
          <Flexbox horizontal align={'center'} gap={8} justify={'space-between'} width={'100%'}>
            <Button loading={archiving} onClick={handleArchive}>
              {t('workspaceSetting.labels.actions.archive')}
            </Button>
            <Flexbox horizontal gap={8}>
              <Button onClick={onClose}>{t('cancel', { ns: 'common' })}</Button>
              <Button danger disabled={!armed} loading={loading} onClick={handleDelete}>
                {t('delete', { ns: 'common' })}
              </Button>
            </Flexbox>
          </Flexbox>
        }
        onCancel={onClose}
      >
        <Flexbox gap={12} paddingBlock={8}>
          <Text>
            {label.usageCount > 0
              ? t('workspaceSetting.labels.delete.descUsed', { count: label.usageCount })
              : t('workspaceSetting.labels.delete.desc')}
          </Text>
          <Text type={'secondary'}>{t('workspaceSetting.labels.delete.archiveHint')}</Text>
          <Text>{t('workspaceSetting.labels.delete.confirmHint')}</Text>
          <Input
            autoFocus
            placeholder={DELETE_CONFIRM_WORD}
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            onPressEnter={handleDelete}
          />
        </Flexbox>
      </ImperativeModal>
    </div>
  );
});

DeleteLabelModal.displayName = 'DeleteLabelModal';

export default DeleteLabelModal;
