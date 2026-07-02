import { ActionIcon, EditableText, SortableList } from '@lobehub/ui';
import { confirmModal } from '@lobehub/ui/base-ui';
import { App } from 'antd';
import { createStaticStyles } from 'antd-style';
import { PencilLine, Trash } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useSessionStore } from '@/store/session';
import { type SessionGroupItem } from '@/types/session';

const styles = createStaticStyles(({ css }) => ({
  content: css`
    position: relative;
    overflow: hidden;
    flex: 1;
  `,
  title: css`
    flex: 1;
    height: 28px;
    line-height: 28px;
    text-align: start;
  `,
}));

interface GroupItemProps extends SessionGroupItem {
  disabled?: boolean;
}

const GroupItem = memo<GroupItemProps>(({ id, name, disabled = false }) => {
  const { t } = useTranslation(['chat', 'common']);
  const { message } = App.useApp();

  const [editing, setEditing] = useState(false);
  const [updateSessionGroupName, removeSessionGroup] = useSessionStore((s) => [
    s.updateSessionGroupName,
    s.removeSessionGroup,
  ]);

  return (
    <>
      {!disabled && <SortableList.DragHandle />}
      {!editing ? (
        <>
          <span className={styles.title}>{name}</span>
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
                return message.warning(t('sessionGroup.tooLong'));

              await updateSessionGroupName(id, input);
              message.success(t('sessionGroup.renameSuccess'));
            }
            setEditing(false);
          }}
        />
      )}
    </>
  );
});

export default GroupItem;
