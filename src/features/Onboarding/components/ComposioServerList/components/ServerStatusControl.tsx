import { Icon } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { CheckIcon, CircleX, Loader2 } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { type ComposioServer } from '@/store/tool/slices/composioStore';
import { ComposioServerStatus } from '@/store/tool/slices/composioStore';

interface ServerStatusControlProps {
  isConnecting: boolean;
  isWaitingAuth: boolean;
  server?: ComposioServer;
}

const ServerStatusControl = memo<ServerStatusControlProps>(
  ({ isConnecting, isWaitingAuth, server }) => {
    const { t } = useTranslation('setting');

    // Loading states
    if (isConnecting || isWaitingAuth) {
      return <Icon spin color={cssVar.colorTextDescription} icon={Loader2} />;
    }

    // No server yet - show nothing (click to connect)
    if (!server) {
      return null;
    }

    // Server status indicators
    switch (server.status) {
      case ComposioServerStatus.ACTIVE: {
        return <Icon color={cssVar.colorSuccess} icon={CheckIcon} />;
      }

      case ComposioServerStatus.PENDING_AUTH: {
        return null;
      }

      case ComposioServerStatus.ERROR: {
        return (
          <Icon
            color={cssVar.colorError}
            icon={CircleX}
            title={t('tools.composio.error', { defaultValue: 'Error' })}
          />
        );
      }

      default: {
        return null;
      }
    }
  },
);

ServerStatusControl.displayName = 'ServerStatusControl';

export default ServerStatusControl;
