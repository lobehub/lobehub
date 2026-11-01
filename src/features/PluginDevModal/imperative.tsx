'use client';

import isEqual from 'fast-deep-equal';
import { memo } from 'react';

import { mountImperative } from '@/components/ImperativeMount';
import { usePermission } from '@/hooks/usePermission';
import { useToolStore } from '@/store/tool';
import { pluginSelectors } from '@/store/tool/selectors';

import DevModal from '.';

interface PluginEditDrawerProps {
  identifier: string;
  onClose: () => void;
  open: boolean;
}

const PluginEditDrawer = memo<PluginEditDrawerProps>(({ identifier, onClose, open }) => {
  const { allowed: canEdit } = usePermission('edit_own_content');
  const value = useToolStore(pluginSelectors.getCustomPluginById(identifier), isEqual);
  const [uninstallPlugin, installCustomPlugin, updateNewCustomPlugin] = useToolStore((s) => [
    s.uninstallCustomPlugin,
    s.installCustomPlugin,
    s.updateNewCustomPlugin,
  ]);

  return (
    <DevModal
      mode={'edit'}
      open={open}
      value={value}
      onValueChange={updateNewCustomPlugin}
      onDelete={() => {
        if (!canEdit) return;
        uninstallPlugin(identifier);
        onClose();
      }}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      onSave={async (devPlugin) => {
        if (!canEdit) return;
        await installCustomPlugin(devPlugin);
        onClose();
      }}
    />
  );
});

PluginEditDrawer.displayName = 'PluginEditDrawer';

export const openPluginEditDrawer = (identifier: string) =>
  mountImperative(({ close, open }) => (
    <PluginEditDrawer identifier={identifier} open={open} onClose={close} />
  ));
