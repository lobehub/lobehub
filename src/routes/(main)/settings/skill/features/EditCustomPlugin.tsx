import isEqual from 'fast-deep-equal';
import { type ReactNode } from 'react';
import { memo } from 'react';

import DevModal from '@/features/PluginDevModal';
import { useToolStore } from '@/store/tool';
import { pluginSelectors } from '@/store/tool/slices/plugin/selectors';

interface EditCustomPluginProps {
  children: ReactNode;
  identifier: string;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}

const EditCustomPlugin = memo<EditCustomPluginProps>(
  ({ identifier, open, onOpenChange, children }) => {
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
          open={open}
          value={customPlugin}
          onOpenChange={onOpenChange}
          onValueChange={updateNewDevPlugin}
          onDelete={() => {
            uninstallCustomPlugin(identifier);
            onOpenChange(false);
          }}
          onSave={async (devPlugin) => {
            await installCustomPlugin(devPlugin);
            onOpenChange(false);
          }}
        />
        {children}
      </div>
    );
  },
);

export default EditCustomPlugin;
