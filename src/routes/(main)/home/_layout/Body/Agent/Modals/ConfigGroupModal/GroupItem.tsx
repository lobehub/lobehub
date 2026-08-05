import { ActionIcon, EditableText, SortableList } from '@lobehub/ui';
import { confirmModal, toast } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { Eye, EyeOff, PencilLine, Trash } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useHomeStore } from '@/store/home';
import type { SessionGroupItemBase } from '@/types/session';

import { useSidebarGroupVisibility } from '../../useSidebarGroupVisibility';

const styles = createStaticStyles(({ css }) => ({
  content: css`
    position: relative;
    overflow: hidden;
    flex: 1;
  `,
  // Hidden folders stay in place (they're still shared, and still ordered) but
  // read as inactive, so the row itself answers "is this in my sidebar?".
  hiddenTitle: css`
    opacity: 0.45;
  `,
  title: css`
    flex: 1;
    height: 28px;
    line-height: 28px;
    text-align: start;
  `,
}));

interface GroupItemProps extends SessionGroupItemBase {
  disabled?: boolean;
}

const GroupItem = memo<GroupItemProps>(({ id, name, disabled }) => {
  const { t } = useTranslation(['chat', 'common']);

  const [editing, setEditing] = useState(false);
  const [updateGroupName, removeGroup] = useHomeStore((s) => [s.updateGroupName, s.removeGroup]);
  const { isSidebarGroupVisible, setSidebarGroupVisible } = useSidebarGroupVisibility();
  const visible = isSidebarGroupVisible(id);

  return (
    <>
      {!disabled && <SortableList.DragHandle />}
      {!editing ? (
        <>
          <span className={`${styles.title} ${visible ? '' : styles.hiddenTitle}`}>{name}</span>
          {/* Visibility is the caller's own view of a shared folder, so it is
              deliberately NOT gated on `disabled` (the edit permission). */}
          <ActionIcon
            icon={visible ? Eye : EyeOff}
            size={'small'}
            title={t(visible ? 'sessionGroup.hideFromSidebar' : 'sessionGroup.showInSidebar')}
            onClick={async () => {
              try {
                await setSidebarGroupVisible(id, !visible);
              } catch (error) {
                console.error('Failed to toggle folder sidebar visibility:', error);
                toast.error(t('operationFailed', { ns: 'common' }));
              }
            }}
          />
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
                  await removeGroup(id);
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

              await updateGroupName(id, input);
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
