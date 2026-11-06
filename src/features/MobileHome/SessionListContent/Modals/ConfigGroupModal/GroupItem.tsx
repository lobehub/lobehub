import { ActionIcon, confirmModal, EditableText, SortableList, toast } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { PencilLine, Trash } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useHomeStore } from '@/store/home';
import { type SessionGroupItemBase } from '@/types/session';

const styles = stylex.create({
  title: { flex: '1', height: '28px', lineHeight: '28px', textAlign: 'start' },
});

interface GroupItemProps extends SessionGroupItemBase {
  disabled?: boolean;
}

const GroupItem = memo<GroupItemProps>(({ id, name, disabled = false }) => {
  const { t } = useTranslation(['chat', 'common']);

  const [editing, setEditing] = useState(false);
  const [updateSessionGroupName, removeSessionGroup] = useHomeStore((s) => [
    s.updateGroupName,
    s.removeGroup,
  ]);

  return (
    <>
      {!disabled && <SortableList.DragHandle />}
      {!editing ? (
        <>
          <span {...stylex.props(styles.title)}>{name}</span>
          <ActionIcon
            disabled={disabled}
            icon={PencilLine}
            size={'small'}
            onClick={() => {
              if (disabled) return;
              setEditing(true);
            }}
          />
          <ActionIcon
            disabled={disabled}
            icon={Trash}
            size={'small'}
            onClick={() => {
              if (disabled) return;
              confirmModal({
                cancelText: t('cancel', { ns: 'common' }),
                content: t('sessionGroup.confirmRemoveGroupAlert'),
                okButtonProps: {
                  danger: true,
                },
                okText: t('delete', { ns: 'common' }),
                onOk: async () => {
                  await removeSessionGroup(id);
                },
                title: t('delete', { ns: 'common' }),
              });
            }}
          />
        </>
      ) : (
        <EditableText
          editing={editing}
          showEditIcon={false}
          style={{ height: 28 }}
          value={name}
          onEditingChange={(e) => setEditing(e)}
          onChangeEnd={async (input) => {
            if (disabled) return;
            if (name !== input) {
              if (!input) return;
              if (input.length === 0 || input.length > 20 || input.trim() === '')
                return toast.warning(t('sessionGroup.tooLong'));

              await updateSessionGroupName(id, input);
              toast.success(t('sessionGroup.renameSuccess'));
            }
            setEditing(false);
          }}
        />
      )}
    </>
  );
});

export default GroupItem;
