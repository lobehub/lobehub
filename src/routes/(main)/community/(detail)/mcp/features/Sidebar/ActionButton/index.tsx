'use client';

import { useDetailContext } from '@/features/MCPPluginDetail/DetailProvider';
import { MarketMcpInstallActions } from '@/features/MCPPluginDetail/MarketMcpInstallActions';

const ActionButton = () => {
  const { haveCloudEndpoint, identifier } = useDetailContext();
  return <MarketMcpInstallActions haveCloudEndpoint={haveCloudEndpoint} identifier={identifier} />;
};

export default ActionButton;
