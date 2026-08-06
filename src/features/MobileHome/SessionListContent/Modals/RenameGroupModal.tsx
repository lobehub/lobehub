import { Flexbox, Input } from '@lobehub/ui';
import { Button, createModal, ModalFooter, toast, useModalContext } from '@lobehub/ui/base-ui';
import isEqual from 'fast-deep-equal';
import { t as translate } from 'i18next';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useSessionStore } from '@/store/session';
import { sessionGroupSelectors } from '@/store/session/selectors';

interface RenameGroupContentProps {
  id: string;
}

const RenameGroupContent = memo<RenameGroupContentProps>(({ id }) => {
  const { t } = useTranslation(['chat', 'common']);
  const { close } = useModalContext();

  const updateSessionGroupName = useSessionStore((s) => s.updateSessionGroupName);
  const group = useSessionStore((s) => sessionGroupSelectors.getGroupById(id)(s), isEqual);

  const [input, setInput] = useState<string>(group?.name ?? '');
  const [loading, setLoading] = useState(false);

  const handleRename = async () => {
    if (loading) return;
    if (input.length === 0 || input.length > 20) return toast.warning(t('sessionGroup.tooLong'));

    setLoading(true);
    try {
      await updateSessionGroupName(id, input);
      toast.success(t('sessionGroup.renameSuccess'));
      close();
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Flexbox paddingBlock={16} paddingInline={16}>
        <Input
          autoFocus
          disabled={loading}
          placeholder={t('sessionGroup.inputPlaceholder')}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onPressEnter={handleRename}
        />
      </Flexbox>
      <ModalFooter>
        <Button onClick={close}>{t('cancel', { ns: 'common' })}</Button>
        <Button loading={loading} type={'primary'} onClick={handleRename}>
          {t('ok', { defaultValue: 'OK', ns: 'common' })}
        </Button>
      </ModalFooter>
    </>
  );
});

RenameGroupContent.displayName = 'MobileRenameGroupContent';

export const openRenameGroupModal = (id: string) =>
  createModal({
    content: <RenameGroupContent id={id} />,
    footer: null,
    styles: { content: { padding: 0 } },
    title: translate('sessionGroup.rename', { ns: 'chat' }),
    width: 400,
  });
