import type { ModalProps } from '@lobehub/ui';
import { Input, Modal } from '@lobehub/ui';
import { App } from 'antd';
import isEqual from 'fast-deep-equal';
import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useHomeStore } from '@/store/home';
import { homeAgentListSelectors } from '@/store/home/selectors';

interface RenameGroupModalProps extends ModalProps {
  id: string;
}

const RenameGroupModal = memo<RenameGroupModalProps>(({ id, open, onCancel }) => {
  const { t } = useTranslation('chat');

  const updateGroupName = useHomeStore((s) => s.updateGroupName);
  const group = useHomeStore(
    (s) => homeAgentListSelectors.agentGroups(s).find((g) => g.id === id),
    isEqual,
  );

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
        await updateGroupName(id, input);
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
