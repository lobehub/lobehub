import { Text } from '@lobehub/ui';
import type { ReactNode } from 'react';

import { useActiveWorkspace } from './useActiveWorkspace';

export const useBusinessChatInputCostEstimateAlert = (): ReactNode => {
  const workspace = useActiveWorkspace();

  return workspace ? (
    <Text fontSize={12} type="secondary">
      Расход будет учтен в workspace «{workspace.name}».
    </Text>
  ) : null;
};

export const getBusinessChatInputSendAreaPrefix = (sendAreaPrefix?: ReactNode): ReactNode =>
  sendAreaPrefix;

export const useBusinessChatInputSendAreaPrefix = getBusinessChatInputSendAreaPrefix;
