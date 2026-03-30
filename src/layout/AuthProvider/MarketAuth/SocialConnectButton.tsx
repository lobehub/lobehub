'use client';

import { SiGithub, SiX } from '@icons-pack/react-simple-icons';
import { ActionIcon, Flexbox, Text, Tooltip } from '@lobehub/ui';
import { Button, Spin } from 'antd';
import { cssVar } from 'antd-style';
import { ArrowRight, Link2Off, Loader2 } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { type SocialProfile, type SocialProvider } from './useSocialConnect';

interface SocialConnectButtonProps {
  disabled?: boolean;
  isConnecting?: boolean;
  isDisconnecting?: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
  profile: SocialProfile | null;
  provider: SocialProvider;
}

const providerIcons: Record<SocialProvider, React.ComponentType<{ size?: number }>> = {
  github: SiGithub,
  twitter: SiX,
};

const providerNames: Record<SocialProvider, string> = {
  github: 'GitHub',
  twitter: 'X (Twitter)',
};

export const SocialConnectButton = memo<SocialConnectButtonProps>(
  ({ provider, profile, isConnecting, isDisconnecting, disabled, onConnect, onDisconnect }) => {
    const { t } = useTranslation('marketAuth');
    const ProviderIcon = providerIcons[provider];
    const providerName = providerNames[provider];

    const isLoading = isConnecting || isDisconnecting;
    const isDisabled = isLoading || disabled;

    if (profile) {
      // Connected state
      return (
        <Flexbox
          horizontal
          align="center"
          gap={12}
          justify="space-between"
          style={{
            background: cssVar.colorFillQuaternary,
            borderRadius: cssVar.borderRadiusLG,
            padding: '8px 12px',
          }}
        >
          <Flexbox horizontal align="center" gap={8}>
            <ProviderIcon size={18} />
            <Flexbox gap={2}>
              <Text style={{ fontSize: 13 }}>@{profile.username}</Text>
              <Text style={{ fontSize: 11 }} type="secondary">
                {t('profileSetup.socialLinks.connected', {
                  defaultValue: 'Connected',
                })}
              </Text>
            </Flexbox>
          </Flexbox>
          <Tooltip title={t('profileSetup.socialLinks.disconnect', { defaultValue: 'Disconnect' })}>
            <ActionIcon
              disabled={isDisabled}
              icon={isDisconnecting ? Loader2 : Link2Off}
              loading={isDisconnecting}
              size="small"
              onClick={onDisconnect}
            />
          </Tooltip>
        </Flexbox>
      );
    }

    // Not connected state
    return (
      <Button
        block
        disabled={isDisabled}
        icon={isConnecting ? <Spin size="small" /> : <ProviderIcon size={16} />}
        style={{
          alignItems: 'center',
          display: 'flex',
          gap: 8,
          height: 40,
          justifyContent: 'flex-start',
          paddingLeft: 12,
        }}
        onClick={onConnect}
      >
        <Flexbox horizontal align="center" flex={1} justify="space-between">
          <span>
            {isConnecting
              ? t('profileSetup.socialLinks.connecting', { defaultValue: 'Connecting...' })
              : t('profileSetup.socialLinks.connectProvider', {
                  defaultValue: `Connect ${providerName}`,
                  provider: providerName,
                })}
          </span>
          {!isConnecting && <ArrowRight size={14} style={{ opacity: 0.5 }} />}
        </Flexbox>
      </Button>
    );
  },
);

SocialConnectButton.displayName = 'SocialConnectButton';

export default SocialConnectButton;
