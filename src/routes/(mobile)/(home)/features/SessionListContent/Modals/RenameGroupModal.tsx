import { type ModalProps } from '@lobehub/ui';
import { Input, Modal } from '@lobehub/ui';
import { App } from 'antd';
import isEqual from 'fast-deep-equal';
import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useSessionStore } from '@/store/session';
import { sessionGroupSelectors } from '@/store/session/selectors';

interface RenameGroupModalProps extends ModalProps {
  id: string;
}

const RenameGroupModal = memo<RenameGroupModalProps>(({ id, open, onCancel }) => {
  const { t } = useTranslation('chat');

  const updateSessionGroupName = useSessionStore((s) => s.updateSessionGroupName);
  const group = useSessionStore((s) => sessionGroupSelectors.getGroupById(id)(s), isEqual);

  const [input, setInput] = useState<string>('');
  const [loading, setLoading] = useState(false);

  const { message } = App.useApp();

  useEffect(() => {
    setInput(group?.name ?? '');
  }, [group]);

  return (
    <Modal
      allowFullscreen
      destroyOnHidden
      okButtonProps={{ loading }}
      open={open}
      title={t('sessionGroup.rename')}
      width={400}
      onCancel={(e) => {
        setInput(group?.name ?? '');
        onCancel?.(e);
      }}
      onOk={async (e) => {
        if (input.length === 0 || input.length > 20)
          return message.warning(t('sessionGroup.tooLong'));
        setLoading(true);
        await updateSessionGroupName(id, input);
        message.success(t('sessionGroup.renameSuccess'));
        setLoading(false);

        onCancel?.(e);
      }}
    >
      <Input
        autoFocus
        defaultValue={group?.name}
        placeholder={t('sessionGroup.inputPlaceholder')}
        value={input}
        onChange={(e) => setInput(e.target.value)}
      />
    </Modal>
  );
});

export default RenameGroupModal;
