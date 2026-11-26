import {
  Button,
  createModal,
  Flexbox,
  Input,
  ModalFooter,
  Text,
  toast,
  useModalContext,
} from '@lobehub/ui';
import { t as translate } from 'i18next';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import InlineErrorText from '@/components/InlineErrorText';
import { type InlineErrorState, toInlineError } from '@/components/InlineErrorText/errorDetail';
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
  /** Name validation, shown under the input it is about. */
  const [nameError, setNameError] = useState('');
  /** Create failure, shown above the footer buttons: the modal stays open with the typed name. */
  const [error, setError] = useState<InlineErrorState | null>(null);

  const handleCreate = async () => {
    // Enter fires as fast as the user repeats it — a second pass while `addGroup`
    // is in flight would create a second group and move the agent into whichever
    // request settles last.
    if (!canCreate || loading) return;
    if (input.length === 0 || input.length > 20 || input.trim() === '')
      return setNameError(t('sessionGroup.tooLong'));

    setError(null);
    setLoading(true);
    try {
      const groupId = await addGroup(input, visibility);
      if (id) await updateAgentGroup(id, groupId);
      toggleExpandSessionGroup(groupId, true);
      toast.success(t('sessionGroup.createSuccess'));
      close();
    } catch (err) {
      // Without this, a rejected create/move leaves the button stuck
      // on loading and the modal open with no explanation.
      console.error('Failed to create category:', err);
      setError(toInlineError(t('sessionGroup.createFailedRetry'), err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Flexbox gap={8} paddingBlock={16} paddingInline={16}>
        <Input
          autoFocus
          aria-invalid={!!nameError || undefined}
          disabled={!canCreate || loading}
          placeholder={t('sessionGroup.inputPlaceholder')}
          value={input}
          onPressEnter={handleCreate}
          onChange={(e) => {
            setInput(e.target.value);
            setNameError('');
            setError(null);
          }}
        />
        {nameError && (
          <Text fontSize={12} role="alert" type="danger">
            {nameError}
          </Text>
        )}
        {error && <InlineErrorText detail={error.detail}>{error.summary}</InlineErrorText>}
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
