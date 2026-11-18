'use client';

import {
  ActionIcon,
  Avatar,
  Block,
  confirmModal,
  DropdownMenu,
  Flexbox,
  Icon,
  stopPropagation,
} from '@lobehub/ui';
import { MoreVerticalIcon, Plus, Trash2 } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import WorkspaceLink from '@/features/Workspace/WorkspaceLink';
import { usePermission } from '@/hooks/usePermission';
import { useToolStore } from '@/store/tool';
import { builtinToolSelectors } from '@/store/tool/selectors';

import { itemStyles } from '../style';

interface ItemProps {
  avatar?: string;
  description?: string;
  detailHref?: string;
  identifier: string;
  onOpenDetail?: () => void;
  title?: string;
}

const Item = memo<ItemProps>((props) => {
  const { avatar, description, detailHref, identifier, onOpenDetail, title } = props;
  const { t } = useTranslation(['setting', 'plugin', 'common']);
  const styles = itemStyles;
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

  const renderAction = () => {
    if (isInstalled) {
      return (
        <DropdownMenu
          placement="bottomRight"
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
        >
          <ActionIcon
            aria-label={t('more', { ns: 'common' })}
            disabled={!canEdit}
            icon={MoreVerticalIcon}
          />
        </DropdownMenu>
      );
    }

    return (
      <ActionIcon
        aria-label={t('tools.builtins.install')}
        disabled={!canCreate}
        icon={Plus}
        title={t('tools.builtins.install')}
        onClick={handleInstall}
      />
    );
  };

  return (
    <Block
      horizontal
      align={'center'}
      className={styles.container}
      gap={12}
      paddingBlock={detailHref ? 8 : 12}
      paddingInline={12}
      style={onOpenDetail ? { cursor: 'pointer' } : undefined}
      variant={detailHref ? 'borderless' : 'outlined'}
      onClick={onOpenDetail}
    >
      <Avatar
        avatar={avatar}
        size={detailHref ? 36 : 40}
        style={{ flex: 'none', marginInlineEnd: 0 }}
      />
      <Flexbox flex={1} gap={4} style={{ minWidth: 0, overflow: 'hidden' }}>
        {detailHref ? (
          <WorkspaceLink className={styles.title} to={detailHref}>
            {title || identifier}
          </WorkspaceLink>
        ) : (
          <span className={styles.title}>{title || identifier}</span>
        )}
        {description && <span className={styles.description}>{description}</span>}
      </Flexbox>
      <div onClick={stopPropagation}>{renderAction()}</div>
    </Block>
  );
});

Item.displayName = 'BuiltinListItem';

export default Item;
