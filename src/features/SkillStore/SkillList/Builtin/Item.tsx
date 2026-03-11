'use client';

import {
  ActionIcon,
  Avatar,
  Block,
  DropdownMenu,
  Flexbox,
  Icon,
  stopPropagation,
} from '@lobehub/ui';
import { App } from 'antd';
import { MoreVerticalIcon, Plus, Trash2 } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useToolStore } from '@/store/tool';
import { builtinToolSelectors } from '@/store/tool/selectors';

import { itemStyles } from '../style';

interface ItemProps {
  avatar?: string;
  description?: string;
  identifier: string;
  onOpenDetail?: () => void;
  title?: string;
}

const Item = memo<ItemProps>(({ avatar, description, identifier, onOpenDetail, title }) => {
  const { t } = useTranslation(['setting', 'plugin']);
  const styles = itemStyles;
  const { modal } = App.useApp();

  const [installBuiltinTool, uninstallBuiltinTool, isInstalled] = useToolStore((s) => [
    s.installBuiltinTool,
    s.uninstallBuiltinTool,
    builtinToolSelectors.isBuiltinToolInstalled(identifier)(s),
  ]);

  const handleInstall = async () => {
    await installBuiltinTool(identifier);
  };

  const handleUninstall = () => {
    modal.confirm({
      centered: true,
      okButtonProps: { danger: true },
      onOk: async () => {
        await uninstallBuiltinTool(identifier);
      },
      title: t('store.actions.confirmUninstall', { ns: 'plugin' }),
      type: 'error',
    });
  };

  const renderAction = () => {
    if (isInstalled) {
      return (
        <DropdownMenu
          nativeButton={false}
          placement="bottomRight"
          items={[
            {
              danger: true,
              icon: <Icon icon={Trash2} />,
              key: 'uninstall',
              label: t('store.actions.uninstall', { ns: 'plugin' }),
              onClick: handleUninstall,
            },
          ]}
        >
          <ActionIcon icon={MoreVerticalIcon} />
        </DropdownMenu>
      );
    }

    return <ActionIcon icon={Plus} title={t('tools.builtins.install')} onClick={handleInstall} />;
  };

  return (
    <Block
      horizontal
      align={'center'}
      className={styles.container}
      gap={12}
      paddingBlock={12}
      paddingInline={12}
      style={{ cursor: 'pointer' }}
      variant={'outlined'}
      onClick={onOpenDetail}
    >
      <Avatar avatar={avatar} size={40} style={{ marginInlineEnd: 0 }} />
      <Flexbox flex={1} gap={4} style={{ minWidth: 0, overflow: 'hidden' }}>
        <span className={styles.title}>{title || identifier}</span>
        {description && <span className={styles.description}>{description}</span>}
      </Flexbox>
      <div onClick={stopPropagation}>{renderAction()}</div>
    </Block>
  );
});

Item.displayName = 'BuiltinListItem';

export default Item;
