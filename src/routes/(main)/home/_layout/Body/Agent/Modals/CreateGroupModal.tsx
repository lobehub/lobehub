import { type ModalProps } from '@lobehub/ui';
import { Flexbox, Input, stopPropagation } from '@lobehub/ui';
import { App, type InputRef } from 'antd';
import { type MouseEvent } from 'react';
import { memo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import ImperativeModal from '@/components/ImperativeModal';
import { usePermission } from '@/hooks/usePermission';
import { useGlobalStore } from '@/store/global';
import { useHomeStore } from '@/store/home';

interface CreateGroupModalProps extends ModalProps {
  /**
   * Agent to move into the newly created group. Omitted when the modal is
   * opened from the sidebar "create group" entry, which only creates the group.
   */
  id?: string;
  visibility?: 'private' | 'public';
}

const CreateGroupModal = memo<CreateGroupModalProps>(
  ({ id, open, onCancel, visibility }: CreateGroupModalProps) => {
    const { t } = useTranslation('chat');
    const { allowed: canCreate } = usePermission('create_content');

    const toggleExpandSessionGroup = useGlobalStore((s) => s.toggleExpandSessionGroup);
    const { message } = App.useApp();
    const [updateAgentGroup, addGroup] = useHomeStore((s) => [s.updateAgentGroup, s.addGroup]);
    // The input stays uncontrolled: ImperativeModal renders this content through
    // the global ModalHost, so a controlled value living in this component only
    // reaches the DOM after an effect-driven update — the lag makes React reset
    // the field mid-IME-composition and CJK input becomes impossible.
    const inputRef = useRef<InputRef>(null);
    const [loading, setLoading] = useState(false);

    return (
      <div onClick={stopPropagation}>
        <ImperativeModal
          allowFullscreen
          destroyOnHidden
          okButtonProps={{ disabled: !canCreate, loading }}
          open={open}
          title={t('sessionGroup.createGroup')}
          width={400}
          onCancel={onCancel}
          onOk={async (e: MouseEvent<HTMLButtonElement>) => {
            if (!canCreate) return;

            const input = inputRef.current?.input?.value ?? '';
            if (input.length === 0 || input.length > 20 || input.trim() === '')
              return message.warning(t('sessionGroup.tooLong'));

            setLoading(true);
            const groupId = await addGroup(input, visibility);
            if (id) await updateAgentGroup(id, groupId);
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
              ref={inputRef}
            />
          </Flexbox>
        </ImperativeModal>
      </div>
    );
  },
);

export default CreateGroupModal;
