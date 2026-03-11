import { ActionIcon } from '@lobehub/ui';
import isEqual from 'fast-deep-equal';
import { PackageSearch } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import DevModal from '@/features/PluginDevModal';
import { useToolStore } from '@/store/tool';
import { pluginSelectors } from '@/store/tool/slices/plugin/selectors';

const EditCustomPlugin = memo<{ identifier: string }>(({ identifier }) => {
  const { t } = useTranslation('plugin');
  const [showModal, setModal] = useState(false);

  const [installCustomPlugin, updateNewDevPlugin, uninstallCustomPlugin] = useToolStore((s) => [
    s.installCustomPlugin,
    s.updateNewCustomPlugin,
    s.uninstallCustomPlugin,
  ]);

  const customPlugin = useToolStore(pluginSelectors.getCustomPluginById(identifier), isEqual);

  return (
    <div
      onClick={(e) => {
        e.stopPropagation();
      }}
    >
      <DevModal
        mode={'edit'}
        open={showModal}
        value={customPlugin}
        onOpenChange={setModal}
        onValueChange={updateNewDevPlugin}
        onDelete={() => {
          uninstallCustomPlugin(identifier);
          setModal(false);
        }}
        onSave={async (devPlugin) => {
          await installCustomPlugin(devPlugin);
          setModal(false);
        }}
      />
      <ActionIcon
        icon={PackageSearch}
        title={t('store.actions.manifest')}
        onClick={() => {
          setModal(true);
        }}
      />
    </div>
  );
});

export default EditCustomPlugin;
