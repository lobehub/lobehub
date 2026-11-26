'use client';

import isEqual from 'fast-deep-equal';
import { memo } from 'react';

import { mountImperative } from '@/components/ImperativeMount';
import { usePermission } from '@/hooks/usePermission';
import { useToolStore } from '@/store/tool';
import { pluginSelectors } from '@/store/tool/selectors';

import DevModal from '.';

interface PluginEditModalProps {
  identifier: string;
  onClose: () => void;
  open: boolean;
}

const PluginEditModal = memo<PluginEditModalProps>(({ identifier, onClose, open }) => {
  const { allowed: canEdit } = usePermission('edit_own_content');
  const value = useToolStore(pluginSelectors.getCustomPluginById(identifier), isEqual);
  const [uninstallPlugin, updateCustomPlugin, updateNewCustomPlugin] = useToolStore((s) => [
    s.uninstallCustomPlugin,
    s.updateCustomPlugin,
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
        // Edits the existing legacy row; new custom MCPs are added as connectors.
        await updateCustomPlugin(identifier, devPlugin);
        onClose();
      }}
    />
  );
});

PluginEditModal.displayName = 'PluginEditModal';

export const openPluginEditModal = (identifier: string) =>
  mountImperative(({ close, open }) => (
    <PluginEditModal identifier={identifier} open={open} onClose={close} />
  ));
