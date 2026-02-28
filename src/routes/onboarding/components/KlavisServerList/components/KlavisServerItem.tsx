'use client';

import { Block, Flexbox, Text } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { memo } from 'react';

import { type KlavisServerType } from '@/const/index';
import { type KlavisServer } from '@/store/tool/slices/klavisStore';
import { KlavisServerStatus } from '@/store/tool/slices/klavisStore';

import { useKlavisOAuth } from '../hooks/useKlavisOAuth';
import { useKlavisServerActions } from '../hooks/useKlavisServerActions';
import ServerIcon from './ServerIcon';
import ServerStatusControl from './ServerStatusControl';

interface KlavisServerItemProps {
  icon: KlavisServerType['icon'];
  identifier: string;
  label: string;
  server?: KlavisServer;
  serverName: string;
}

const KlavisServerItem = memo<KlavisServerItemProps>(
  ({ identifier, label, server, serverName, icon }) => {
    const { isWaitingAuth, openOAuthWindow } = useKlavisOAuth({
      serverStatus: server?.status,
    });

    const { isConnecting, handleConnect } = useKlavisServerActions({
      identifier,
      onAuthRequired: openOAuthWindow,
      server,
      serverName,
    });

    const isConnected = server?.status === KlavisServerStatus.CONNECTED;
    const isPendingAuth = server?.status === KlavisServerStatus.PENDING_AUTH;
    const isClickable = !isConnected;

    const handleItemClick = () => {
      if (isConnected) return;

      if (!server) {
        handleConnect();
      } else if (isPendingAuth && server.oauthUrl) {
        openOAuthWindow(server.oauthUrl, server.identifier);
      }
    };

    return (
      <Block
        horizontal
        align="center"
        clickable={isClickable}
        gap={8}
        justify="space-between"
        padding={12}
        variant={'outlined'}
        style={
          isConnected
            ? {
                background: cssVar.colorSuccessBg,
                borderColor: cssVar.colorSuccessBorder,
              }
            : {}
        }
        onClick={handleItemClick}
      >
        <Flexbox
          horizontal
          align="center"
          flex={1}
          gap={12}
          style={{
            overflow: 'hidden',
          }}
        >
          <ServerIcon icon={icon} label={label} />
          <Text ellipsis>{label}</Text>
        </Flexbox>

        <ServerStatusControl
          isConnecting={isConnecting}
          isWaitingAuth={isWaitingAuth}
          server={server}
        />
      </Block>
    );
  },
);

KlavisServerItem.displayName = 'KlavisServerItem';

export default KlavisServerItem;
