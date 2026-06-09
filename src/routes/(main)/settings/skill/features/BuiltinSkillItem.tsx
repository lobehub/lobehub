'use client';

import { Avatar, Button, DropdownMenu, Flexbox, Icon, stopPropagation } from '@lobehub/ui';
import { confirmModal } from '@lobehub/ui/base-ui';
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
  isSelected?: boolean;
  onSelect?: () => void;
  title: string;
}

const BuiltinSkillItem = memo<BuiltinSkillItemProps>(
  ({ identifier, title, avatar, isSelected, onSelect }) => {
    const { t } = useTranslation(['setting', 'plugin', 'common']);

    const [installBuiltinTool, uninstallBuiltinTool, isInstalled] = useToolStore((s) => [
      s.installBuiltinTool,
      s.uninstallBuiltinTool,
      builtinToolSelectors.isBuiltinToolInstalled(identifier)(s),
    ]);

    const handleInstall = async () => {
      await installBuiltinTool(identifier);
    };

    const handleUninstall = () => {
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

    const renderStatus = () => {
      if (isInstalled) {
        return (
          <span className={styles.connected}>
            {t('tools.builtins.installed', { ns: 'setting' })}
          </span>
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
        gap={8}
        justify="space-between"
        style={{
          ...(isSelected ? { background: 'var(--ant-color-primary-bg)', borderRadius: 6 } : {}),
          ...(onSelect ? { cursor: 'pointer' } : {}),
        }}
        onClick={onSelect}
      >
        <Flexbox horizontal align="center" gap={8} style={{ flex: 1, overflow: 'hidden' }}>
          <Flexbox
            horizontal
            align="center"
            gap={8}
            style={{ cursor: onSelect ? undefined : 'pointer' }}
            onClick={onSelect ? undefined : () => createBuiltinSkillDetailModal({ identifier })}
          >
            <div className={`${styles.icon} ${!isInstalled ? styles.disconnectedIcon : ''}`}>
              <Avatar avatar={avatar} size={16} />
            </div>
            <span className={`${styles.title} ${!isInstalled ? styles.disconnectedTitle : ''}`}>
              {title}
            </span>
          </Flexbox>
          {!isInstalled && renderStatus()}
        </Flexbox>
        {!onSelect && (
          <Flexbox horizontal align="center" gap={8} onClick={stopPropagation}>
            {isInstalled && renderStatus()}
            {renderActions()}
          </Flexbox>
        )}
      </Flexbox>
    );
  },
);

BuiltinSkillItem.displayName = 'BuiltinSkillItem';

export default BuiltinSkillItem;
