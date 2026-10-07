// Fixture: an Electron IPC bridge whose service name does not say "electron".
import { memo } from 'react';

import { useClientDataSWR } from '@/libs/swr';
import { imessageBridgeService } from '@/services/electron/imessageBridge';

const BridgeStatus = memo<{ applicationId: string }>(({ applicationId }) => {
  const { data: status } = useClientDataSWR('imessage-bridge-status', () =>
    imessageBridgeService.getStatus(),
  );

  const config = status?.configs.find((item) => item.applicationId === applicationId);

  return <span>{config ? config.label : '—'}</span>;
});

export default BridgeStatus;
