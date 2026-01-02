import isEqual from 'fast-deep-equal';
import { type ReactNode, memo } from 'react';

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
          onDelete={() => {
            uninstallCustomPlugin(identifier);
            onOpenChange(false);
          }}
          onOpenChange={onOpenChange}
          onSave={async (devPlugin) => {
            await installCustomPlugin(devPlugin);
            onOpenChange(false);
          }}
          onValueChange={updateNewDevPlugin}
          open={open}
          value={customPlugin}
        />
        {children}
      </div>
    );
  },
);

export default EditCustomPlugin;
