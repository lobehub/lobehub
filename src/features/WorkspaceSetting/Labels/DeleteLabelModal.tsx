import { type AgentLabelListItem } from '@lobechat/types';
import { Flexbox, Input, Text } from '@lobehub/ui';
import { Button, createModal, ModalFooter, toast, useModalContext } from '@lobehub/ui/base-ui';
import { t as translate } from 'i18next';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useHomeStore } from '@/store/home';

/** The word the user must type to arm the Delete button (mirrors Linear). */
const DELETE_CONFIRM_WORD = 'delete';

interface DeleteLabelContentProps {
  label: AgentLabelListItem;
}

/**
 * Destructive-delete confirm: deleting removes the label from every agent and
 * cannot be undone, so the modal requires typing `delete` and offers Archive
 * as the reversible alternative (mirrors the Linear flow in the issue spec).
 */
const DeleteLabelContent = memo<DeleteLabelContentProps>(({ label }) => {
  const { t } = useTranslation(['setting', 'common']);
  const { close } = useModalContext();
  const [removeAgentLabel, updateAgentLabel] = useHomeStore((s) => [
    s.removeAgentLabel,
    s.updateAgentLabel,
  ]);

  const [confirmText, setConfirmText] = useState('');
  const [loading, setLoading] = useState(false);
  const [archiving, setArchiving] = useState(false);

  const armed = confirmText.trim().toLowerCase() === DELETE_CONFIRM_WORD;

  const handleDelete = async () => {
    if (!armed || loading || archiving) return;
    setLoading(true);
    try {
      await removeAgentLabel(label.id);
      toast.success(t('workspaceSetting.labels.delete.success'));
      close();
    } catch (error) {
      console.error('Failed to delete label:', error);
      toast.error(t('operationFailed', { ns: 'common' }));
    } finally {
      setLoading(false);
    }
  };

  const handleArchive = async () => {
    if (loading || archiving) return;
    setArchiving(true);
    try {
      await updateAgentLabel(label.id, { archived: true });
      toast.success(t('workspaceSetting.labels.archive.success'));
      close();
    } catch (error) {
      console.error('Failed to archive label:', error);
      toast.error(t('operationFailed', { ns: 'common' }));
    } finally {
      setArchiving(false);
    }
  };

  return (
    <>
      <Flexbox gap={12} paddingBlock={8} paddingInline={16}>
        <Text>
          {label.usageCount > 0
            ? t('workspaceSetting.labels.delete.descUsed', { count: label.usageCount })
            : t('workspaceSetting.labels.delete.desc')}
        </Text>
        <Text type={'secondary'}>{t('workspaceSetting.labels.delete.archiveHint')}</Text>
        <Text>{t('workspaceSetting.labels.delete.confirmHint')}</Text>
        <Input
          autoFocus
          disabled={loading || archiving}
          placeholder={DELETE_CONFIRM_WORD}
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          onPressEnter={handleDelete}
        />
      </Flexbox>
      {/* Archive and Delete both mutate the same label, so each locks the other
          out — `loading` alone only disables the button that owns it. */}
      <ModalFooter style={{ justifyContent: 'space-between' }}>
        <Button disabled={loading} loading={archiving} onClick={handleArchive}>
          {t('workspaceSetting.labels.actions.archive')}
        </Button>
        <Flexbox horizontal gap={8}>
          <Button onClick={close}>{t('cancel', { ns: 'common' })}</Button>
          <Button danger disabled={!armed || archiving} loading={loading} onClick={handleDelete}>
            {t('delete', { ns: 'common' })}
          </Button>
        </Flexbox>
      </ModalFooter>
    </>
  );
});

DeleteLabelContent.displayName = 'DeleteLabelContent';

export const openDeleteLabelModal = (label: AgentLabelListItem) =>
  createModal({
    content: <DeleteLabelContent label={label} />,
    footer: null,
    styles: { content: { padding: 0 } },
    title: translate('workspaceSetting.labels.delete.title', { name: label.name, ns: 'setting' }),
    width: 460,
  });
