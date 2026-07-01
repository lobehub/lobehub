import { type ModalProps } from '@lobehub/ui';
import { Flexbox, Input, Modal, stopPropagation } from '@lobehub/ui';
import { App } from 'antd';
import { type MouseEvent } from 'react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { usePermission } from '@/hooks/usePermission';
import { useGlobalStore } from '@/store/global';
import { useHomeStore } from '@/store/home';

interface CreateGroupModalProps extends ModalProps {
  id: string;
  visibility?: 'private' | 'public';
}

const CreateGroupModal = memo<CreateGroupModalProps>(
  ({ id, open, onCancel, visibility }: CreateGroupModalProps) => {
    const { t } = useTranslation('chat');
    const { allowed: canCreate } = usePermission('create_content');

    const toggleExpandSessionGroup = useGlobalStore((s) => s.toggleExpandSessionGroup);
    const { message } = App.useApp();
    const [updateAgentGroup, addGroup] = useHomeStore((s) => [s.updateAgentGroup, s.addGroup]);
    const [input, setInput] = useState('');
    const [loading, setLoading] = useState(false);

    return (
      <div onClick={stopPropagation}>
        <Modal
          allowFullscreen
          destroyOnHidden
          okButtonProps={{ disabled: !canCreate, loading }}
          open={open}
          title={t('sessionGroup.createGroup')}
          width={400}
          onCancel={(e) => {
            setInput('');
            onCancel?.(e);
          }}
          onOk={async (e: MouseEvent<HTMLButtonElement>) => {
            if (!canCreate) return;

            if (input.length === 0 || input.length > 20 || input.trim() === '')
              return message.warning(t('sessionGroup.tooLong'));

            setLoading(true);
            const groupId = await addGroup(input, visibility);
            await updateAgentGroup(id, groupId);
            toggleExpandSessionGroup(groupId, true);
            setLoading(false);

            message.success(t('sessionGroup.createSuccess'));
            onCancel?.(e);
          }}
        >
          <Flexbox paddingBlock={16}>
            <Input
              autoFocus
              disabled={!canCreate}
              placeholder={t('sessionGroup.inputPlaceholder')}
              value={input}
              onChange={(e) => setInput(e.target.value)}
            />
          </Flexbox>
        </Modal>
      </div>
    );
  },
);

export default CreateGroupModal;
