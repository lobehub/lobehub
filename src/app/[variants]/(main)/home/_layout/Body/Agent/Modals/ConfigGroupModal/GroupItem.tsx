import { ActionIcon, EditableText, SortableList } from '@lobehub/ui';
import { App } from 'antd';
import { createStaticStyles } from 'antd-style';
import { PencilLine, Trash } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useHomeStore } from '@/store/home';
import type { SessionGroupItemBase } from '@/types/session';

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

const GroupItem = memo<SessionGroupItemBase>(({ id, name }) => {
  const { t } = useTranslation('chat');
  const { message, modal } = App.useApp();

  const [editing, setEditing] = useState(false);
  const [updateGroupName, removeGroup] = useHomeStore((s) => [s.updateGroupName, s.removeGroup]);

  return (
    <>
      <SortableList.DragHandle />
      {!editing ? (
        <>
          <span className={styles.title}>{name}</span>
          <ActionIcon icon={PencilLine} onClick={() => setEditing(true)} size={'small'} />
          <ActionIcon
            icon={Trash}
            onClick={() => {
              modal.confirm({
                centered: true,
                okButtonProps: {
                  danger: true,
                  type: 'primary',
                },
                onOk: async () => {
                  await removeGroup(id);
                },
                title: t('sessionGroup.confirmRemoveGroupAlert'),
              });
            }}
            size={'small'}
          />
        </>
      ) : (
        <EditableText
          editing={editing}
          onChangeEnd={async (input) => {
            if (name !== input) {
              if (!input) return;
              if (input.length === 0 || input.length > 20 || input.trim() === '')
                return message.warning(t('sessionGroup.tooLong'));

              await updateGroupName(id, input);
              message.success(t('sessionGroup.renameSuccess'));
            }
            setEditing(false);
          }}
          onEditingChange={(e) => setEditing(e)}
          showEditIcon={false}
          style={{ height: 28 }}
          value={name}
        />
      )}
    </>
  );
});

export default GroupItem;
