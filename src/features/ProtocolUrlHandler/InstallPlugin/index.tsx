'use client';

import { memo } from 'react';

import CustomPluginInstallModal from './CustomPluginInstallModal';
import OfficialPluginInstallModal from './OfficialPluginInstallModal';
import { type McpInstallRequest } from './types';
import { PluginSource } from './types';

interface PluginInstallConfirmModalProps {
  installRequest: McpInstallRequest | null;
  onComplete: () => void;
}

/**
 * Determine plugin type based on the source of the install request
 */
const getPluginSource = (request: McpInstallRequest): PluginSource => {
  const { marketId } = request;

  // Official LobeHub plugin
  if (marketId === 'lobehub') {
    return PluginSource.OFFICIAL;
  }

  // Third-party marketplace plugin (including trusted and untrusted)
  if (marketId && marketId !== 'lobehub') {
    return PluginSource.MARKETPLACE;
  }

  // Custom plugin (no marketId)
  return PluginSource.CUSTOM;
};

const PluginInstallConfirmModal = memo<PluginInstallConfirmModalProps>(
  ({ installRequest, onComplete }) => {
    if (!installRequest) return null;

    const pluginSource = getPluginSource(installRequest);

    if (pluginSource === PluginSource.OFFICIAL)
      return <OfficialPluginInstallModal installRequest={installRequest} onComplete={onComplete} />;

    return (
      <CustomPluginInstallModal
        installRequest={installRequest}
        isMarketplace={pluginSource === PluginSource.MARKETPLACE}
        onComplete={onComplete}
      />
    );
  },
);

PluginInstallConfirmModal.displayName = 'PluginInstallConfirmModal';

export default PluginInstallConfirmModal;
