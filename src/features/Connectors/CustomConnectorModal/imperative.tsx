'use client';

import isEqual from 'fast-deep-equal';
import { memo } from 'react';

import { mountImperative } from '@/components/ImperativeMount';
import { useToolStore } from '@/store/tool';
import { pluginSelectors } from '@/store/tool/slices/plugin/selectors';

import CustomConnectorModal from '.';

export const openConnectorEditModal = (connectorId: string) =>
  mountImperative(({ close, open }) => (
    <CustomConnectorModal
      connectorId={connectorId}
      open={open}
      onClose={close}
      onEditSuccess={close}
    />
  ));

interface LegacyPluginMigrationModalProps {
  identifier: string;
  onClose: () => void;
  open: boolean;
}

const LegacyPluginMigrationModal = memo<LegacyPluginMigrationModalProps>(
  ({ identifier, onClose, open }) => {
    const legacyPlugin = useToolStore(pluginSelectors.getCustomPluginById(identifier), isEqual);
    if (!legacyPlugin) return null;

    return (
      <CustomConnectorModal
        legacyPlugin={legacyPlugin}
        open={open}
        onClose={onClose}
        onEditSuccess={onClose}
      />
    );
  },
);

LegacyPluginMigrationModal.displayName = 'LegacyPluginMigrationModal';

export const openLegacyPluginMigrationModal = (identifier: string) =>
  mountImperative(({ close, open }) => (
    <LegacyPluginMigrationModal identifier={identifier} open={open} onClose={close} />
  ));
