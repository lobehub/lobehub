import { memo } from 'react';

import { useGatewayMuxWarmup } from '@/hooks/useGatewayMuxWarmup';

/** Render-less: dials the per-user gateway socket once the user is in the app. */
const GatewayMuxWarmup = memo(() => {
  useGatewayMuxWarmup();
  return null;
});

GatewayMuxWarmup.displayName = 'GatewayMuxWarmup';

export default GatewayMuxWarmup;
