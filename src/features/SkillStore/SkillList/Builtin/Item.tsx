'use client';

import { Avatar, confirmModal, Icon } from '@lobehub/ui';
import { Trash2 } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { RowAddAction, RowMoreMenu } from '@/features/Settings/skill/features/RowActions';
import SkillListRow from '@/features/Settings/skill/features/SkillListRow';
import { usePermission } from '@/hooks/usePermission';
import { useToolStore } from '@/store/tool';
import { builtinToolSelectors } from '@/store/tool/selectors';

interface ItemProps {
  avatar?: string;
  description?: string;
  identifier: string;
  onOpenDetail?: () => void;
  title?: string;
}

/** A built-in in the store, drawn as the Connectors page row: `+` installs, `⋯` manages. */
const Item = memo<ItemProps>(({ avatar, description, identifier, onOpenDetail, title }) => {
  const { t } = useTranslation(['setting', 'plugin', 'common']);
  const { allowed: canCreate } = usePermission('create_content');
  const { allowed: canEdit } = usePermission('edit_own_content');

  const [installBuiltinTool, uninstallBuiltinTool, isInstalled] = useToolStore((s) => [
    s.installBuiltinTool,
    s.uninstallBuiltinTool,
    builtinToolSelectors.isBuiltinToolInstalled(identifier)(s),
  ]);

  const handleInstall = async () => {
    if (!canCreate) return;
    await installBuiltinTool(identifier);
  };

  const handleUninstall = () => {
    if (!canEdit) return;
    confirmModal({
      cancelText: t('cancel', { ns: 'common' }),
      content: t('store.actions.confirmUninstall', { ns: 'plugin' }),
      okButtonProps: { danger: true },
      okText: t('store.actions.uninstall', { ns: 'plugin' }),
      onOk: async () => {
        await uninstallBuiltinTool(identifier);
      },
      title: t('store.actions.uninstall', { ns: 'plugin' }),
    });
  };

  return (
    <SkillListRow
      icon={() => <Avatar avatar={avatar} size={20} />}
      summary={description}
      title={title || identifier}
      extra={
        isInstalled ? (
          <RowMoreMenu
            items={[
              {
                danger: true,
                disabled: !canEdit,
                icon: <Icon icon={Trash2} />,
                key: 'uninstall',
                label: t('store.actions.uninstall', { ns: 'plugin' }),
                onClick: handleUninstall,
              },
            ]}
            onOpenDetail={onOpenDetail}
          />
        ) : (
          <RowAddAction
            disabled={!canCreate}
            label={t('connectorMarket.action.install')}
            onClick={handleInstall}
          />
        )
      }
      onClick={onOpenDetail}
    />
  );
});

Item.displayName = 'BuiltinListItem';

export default Item;
