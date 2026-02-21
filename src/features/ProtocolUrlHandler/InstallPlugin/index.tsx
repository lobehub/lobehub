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
 * 根据安装请求的来源确定插件类型
 */
const getPluginSource = (request: McpInstallRequest): PluginSource => {
  const { marketId } = request;

  // 官方 LobeHub 插件
  if (marketId === 'lobehub') {
    return PluginSource.OFFICIAL;
  }

  // 第三方市场插件（包括可信和不可信的）
  if (marketId && marketId !== 'lobehub') {
    return PluginSource.MARKETPLACE;
  }

  // 自定义插件（没有 marketId）
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
