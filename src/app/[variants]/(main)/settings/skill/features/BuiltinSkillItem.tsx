'use client';

import { Avatar, Button, DropdownMenu, Flexbox, Icon, stopPropagation } from '@lobehub/ui';
import { App } from 'antd';
import { MoreHorizontalIcon, Plus, Trash2 } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { createBuiltinSkillDetailModal } from '@/features/SkillStore/SkillDetail';
import { useToolStore } from '@/store/tool';
import { builtinToolSelectors } from '@/store/tool/selectors';

import { styles } from './style';

interface BuiltinSkillItemProps {
  avatar?: string;
  identifier: string;
  title: string;
}

const BuiltinSkillItem = memo<BuiltinSkillItemProps>(({ identifier, title, avatar }) => {
  const { t } = useTranslation(['setting', 'plugin']);
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

  const renderStatus = () => {
    if (isInstalled) {
      return (
        <span className={styles.connected}>{t('tools.builtins.installed', { ns: 'setting' })}</span>
      );
    }
    return (
      <span className={styles.disconnected}>
        {t('tools.builtins.uninstalled', { ns: 'setting' })}
      </span>
    );
  };

  const renderActions = () => {
    if (isInstalled) {
      return (
        <DropdownMenu
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
          <Button icon={MoreHorizontalIcon} />
        </DropdownMenu>
      );
    }

    return (
      <Button icon={Plus} onClick={handleInstall}>
        {t('store.actions.install', { ns: 'plugin' })}
      </Button>
    );
  };

  return (
    <Flexbox
      horizontal
      align="center"
      className={styles.container}
      gap={16}
      justify="space-between"
    >
      <Flexbox horizontal align="center" gap={16} style={{ flex: 1, overflow: 'hidden' }}>
        <Flexbox
          horizontal
          align="center"
          gap={16}
          style={{ cursor: 'pointer' }}
          onClick={() => createBuiltinSkillDetailModal({ identifier })}
        >
          <div className={`${styles.icon} ${!isInstalled ? styles.disconnectedIcon : ''}`}>
            <Avatar avatar={avatar} size={32} />
          </div>
          <Flexbox gap={4} style={{ overflow: 'hidden' }}>
            <span className={`${styles.title} ${!isInstalled ? styles.disconnectedTitle : ''}`}>
              {title}
            </span>
            {!isInstalled && renderStatus()}
          </Flexbox>
        </Flexbox>
      </Flexbox>
      <Flexbox horizontal align="center" gap={12} onClick={stopPropagation}>
        {isInstalled && renderStatus()}
        {renderActions()}
      </Flexbox>
    </Flexbox>
  );
});

BuiltinSkillItem.displayName = 'BuiltinSkillItem';

export default BuiltinSkillItem;
