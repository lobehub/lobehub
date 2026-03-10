import { ActionIcon, EditableText, SortableList } from '@lobehub/ui';
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

const GroupItem = memo<SessionGroupItem>(({ id, name }) => {
  const { t } = useTranslation('chat');
  const { message, modal } = App.useApp();

  const [editing, setEditing] = useState(false);
  const [updateSessionGroupName, removeSessionGroup] = useSessionStore((s) => [
    s.updateSessionGroupName,
    s.removeSessionGroup,
  ]);

  return (
    <>
      <SortableList.DragHandle />
      {!editing ? (
        <>
          <span className={styles.title}>{name}</span>
          <ActionIcon icon={PencilLine} size={'small'} onClick={() => setEditing(true)} />
          <ActionIcon
            icon={Trash}
            size={'small'}
            onClick={() => {
              modal.confirm({
                centered: true,
                okButtonProps: {
                  danger: true,
                  type: 'primary',
                },
                onOk: async () => {
                  await removeSessionGroup(id);
                },
                title: t('sessionGroup.confirmRemoveGroupAlert'),
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
