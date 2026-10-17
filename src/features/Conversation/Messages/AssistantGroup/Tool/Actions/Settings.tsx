import { ActionIcon } from '@lobehub/ui';
import { LucideSettings } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { createPluginDetailModal } from '@/features/PluginDetailModal';
import { pluginHelpers, useToolStore } from '@/store/tool';
import { pluginSelectors } from '@/store/tool/selectors';

const Settings = memo<{ id: string }>(({ id }) => {
  const item = useToolStore(pluginSelectors.getToolManifestById(id));

  const { t } = useTranslation('plugin');
  const hasSettings = pluginHelpers.isSettingSchemaNonEmpty(item?.settings);
  if (!hasSettings) return;

  return (
    <ActionIcon
      icon={LucideSettings}
      size={'small'}
      title={t('setting')}
      onClick={() => {
        createPluginDetailModal({
          id,
          schema: item?.settings,
          tab: 'settings',
        });
      }}
    />
  );
});

export default Settings;
