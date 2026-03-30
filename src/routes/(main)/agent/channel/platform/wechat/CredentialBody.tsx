'use client';

import { memo, useCallback } from 'react';

import type { PlatformCredentialBodyProps } from '../types';
import ConnectedInfo from './ConnectedInfo';
import QrCodeAuth from './QrCodeAuth';

const CredentialBody = memo<PlatformCredentialBodyProps>(
  ({ currentConfig, hasConfig, onAuthenticated }) => {
    const handleQrAuthenticated = useCallback(
      (creds: { botId: string; botToken: string; userId: string }) => {
        const botToken = creds.botToken?.trim();
        if (!creds.botId && !botToken) return;

        const applicationId = creds.botId || botToken?.slice(0, 16) || '';
        onAuthenticated?.({
          applicationId,
          credentials: {
            botId: creds.botId,
            botToken: creds.botToken,
            userId: creds.userId,
          },
        });
      },
      [onAuthenticated],
    );

    if (hasConfig && currentConfig) {
      return (
        <ConnectedInfo currentConfig={currentConfig} onQrAuthenticated={handleQrAuthenticated} />
      );
    }

    if (onAuthenticated) {
      return (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '16px 0' }}>
          <QrCodeAuth onAuthenticated={handleQrAuthenticated} />
        </div>
      );
    }

    return null;
  },
);

export default CredentialBody;
