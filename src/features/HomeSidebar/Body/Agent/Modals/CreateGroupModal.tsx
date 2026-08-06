import { Flexbox, Input } from '@lobehub/ui';
import { Button, createModal, ModalFooter, toast, useModalContext } from '@lobehub/ui/base-ui';
import { t as translate } from 'i18next';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { usePermission } from '@/hooks/usePermission';
import { useGlobalStore } from '@/store/global';
import { useHomeStore } from '@/store/home';

interface CreateGroupModalOptions {
  /**
   * Agent to move into the newly created group. Omitted when the modal is
   * opened from the sidebar "create group" entry, which only creates the group.
   */
  id?: string;
  visibility?: 'private' | 'public';
}

const CreateGroupContent = memo<CreateGroupModalOptions>(({ id, visibility }) => {
  const { t } = useTranslation(['chat', 'common']);
  const { close } = useModalContext();
  const { allowed: canCreate } = usePermission('create_content');

  const toggleExpandSessionGroup = useGlobalStore((s) => s.toggleExpandSessionGroup);
  const [updateAgentGroup, addGroup] = useHomeStore((s) => [s.updateAgentGroup, s.addGroup]);

  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);

  const handleCreate = async () => {
    // Enter fires as fast as the user repeats it — a second pass while `addGroup`
    // is in flight would create a second group and move the agent into whichever
    // request settles last.
    if (!canCreate || loading) return;
    if (input.length === 0 || input.length > 20 || input.trim() === '')
      return toast.warning(t('sessionGroup.tooLong'));

    setLoading(true);
    try {
      const groupId = await addGroup(input, visibility);
      if (id) await updateAgentGroup(id, groupId);
      toggleExpandSessionGroup(groupId, true);
      toast.success(t('sessionGroup.createSuccess'));
      close();
    } catch (error) {
      // Without this, a rejected create/move leaves the button stuck
      // on loading and the modal open with no explanation.
      console.error('Failed to create category:', error);
      toast.error(t('operationFailed', { ns: 'common' }));
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Flexbox paddingBlock={16} paddingInline={16}>
        <Input
          autoFocus
          disabled={!canCreate || loading}
          placeholder={t('sessionGroup.inputPlaceholder')}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onPressEnter={handleCreate}
        />
      </Flexbox>
      <ModalFooter>
        <Button onClick={close}>{t('cancel', { ns: 'common' })}</Button>
        <Button disabled={!canCreate} loading={loading} type={'primary'} onClick={handleCreate}>
          {t('ok', { defaultValue: 'OK', ns: 'common' })}
        </Button>
      </ModalFooter>
    </>
  );
});

CreateGroupContent.displayName = 'HomeCreateGroupContent';

export const openCreateGroupModal = (options: CreateGroupModalOptions = {}) =>
  createModal({
    content: <CreateGroupContent {...options} />,
    footer: null,
    styles: { content: { padding: 0 } },
    title: translate('sessionGroup.createGroup', { ns: 'chat' }),
    width: 400,
  });
