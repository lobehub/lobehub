import { ActionIcon, createRawModal } from '@lobehub/ui';
import { LucideSettings } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { type PluginDetailModalProps } from '@/features/PluginDetailModal';
import dynamic from '@/libs/next/dynamic';
import { pluginHelpers, useToolStore } from '@/store/tool';
import { pluginSelectors } from '@/store/tool/selectors';

const PluginDetailModal = dynamic<PluginDetailModalProps>(
  () => import('@/features/PluginDetailModal'),
  {
    ssr: false,
  },
);

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
        createRawModal(PluginDetailModal, {
          id,
          schema: item?.settings,
        });
      }}
    />
  );
});

export default Settings;
