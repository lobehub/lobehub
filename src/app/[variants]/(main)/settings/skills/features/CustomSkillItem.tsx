'use client';

import { FormItem, Icon } from '@lobehub/ui';
import { Button } from 'antd';
import { createStyles } from 'antd-style';
import { Settings, Trash2 } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import PluginAvatar from '@/components/Plugins/PluginAvatar';
import { useToolStore } from '@/store/tool';
import type { InstallPluginMeta } from '@/types/tool/plugin';

const useStyles = createStyles(({ css, token }) => ({
  actions: css`
    display: flex;
    gap: 8px;
  `,
  icon: css`
    display: flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;

    width: 40px;
    height: 40px;

    background: ${token.colorFillTertiary};
    border-radius: 8px;
  `,
  installed: css`
    color: ${token.colorSuccess};
  `,
}));

interface CustomSkillItemProps {
  plugin: InstallPluginMeta;
}

const CustomSkillItem = memo<CustomSkillItemProps>(({ plugin }) => {
  const { t } = useTranslation('setting');
  const { styles } = useStyles();
  const uninstallPlugin = useToolStore((s) => s.uninstallPlugin);

  const handleUninstall = async () => {
    await uninstallPlugin(plugin.identifier);
  };

  const renderIcon = () => {
    if (plugin.avatar) {
      return <PluginAvatar avatar={plugin.avatar} size={24} />;
    }
    return <Icon icon={Settings} size={24} />;
  };

  return (
    <FormItem
      avatar={<div className={styles.icon}>{renderIcon()}</div>}
      desc={plugin.description || <span className={styles.installed}>Installed</span>}
      label={plugin.title || plugin.identifier}
    >
      <div className={styles.actions}>
        <Button
          danger
          icon={<Icon icon={Trash2} />}
          onClick={handleUninstall}
          title={t('plugin.clearDeprecated')}
          type="text"
        />
      </div>
    </FormItem>
  );
});

CustomSkillItem.displayName = 'CustomSkillItem';

export default CustomSkillItem;
