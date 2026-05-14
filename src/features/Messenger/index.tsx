'use client';

import { Button, Flexbox, Modal, Skeleton, Text } from '@lobehub/ui';
import { App } from 'antd';
import { createStaticStyles } from 'antd-style';
import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import useSWR from 'swr';

import { messengerService } from '@/services/messenger';

import { type MessengerPlatform, PlatformAvatar } from './constants';
import { getDiscordInstallErrorReason, getSlackInstallErrorReason } from './i18n';
import IntegrationDetail from './IntegrationDetail';
import IntegrationList from './IntegrationList';

interface BlockedInstall {
  // Empty string sentinel = open modal even when the tenant name is unknown.
  name: string;
  platform: 'slack' | 'discord';
}

const VALID_PLATFORMS: ReadonlySet<MessengerPlatform> = new Set(['slack', 'telegram', 'discord']);

const isMessengerPlatform = (value: string | undefined): value is MessengerPlatform =>
  !!value && VALID_PLATFORMS.has(value as MessengerPlatform);

const styles = createStaticStyles(({ css, cssVar }) => ({
  emptyState: css`
    padding-block: 48px;
    padding-inline: 24px;
    border: 1px dashed ${cssVar.colorBorder};
    border-radius: ${cssVar.borderRadius};

    color: ${cssVar.colorTextSecondary};
    text-align: center;
  `,
  page: css`
    overflow-y: auto;
    flex: 1;
  `,
}));

const MessengerSettings = memo(() => {
  const { t } = useTranslation('messenger');
  const { message } = App.useApp();
  const navigate = useNavigate();
  const params = useParams<{ sub?: string }>();
  const selected: MessengerPlatform | null = isMessengerPlatform(params.sub) ? params.sub : null;
  // Tenant name from `?workspace=...` plus the platform it belongs to. When
  // set, render the takeover explainer modal — toast is too transient for a
  // flow where the user just round-tripped through OAuth and needs clear
  // next-step guidance.
  const [blocked, setBlocked] = useState<BlockedInstall | null>(null);

  const platformsSWR = useSWR('messenger:availablePlatforms', () =>
    messengerService.availablePlatforms(),
  );

  // If the URL points at an unknown platform sub-segment, replace it with the
  // bare list URL — keeps deep-links graceful when bots get removed from the
  // registry.
  useEffect(() => {
    if (params.sub && !isMessengerPlatform(params.sub)) {
      navigate('/settings/messenger', { replace: true });
    }
  }, [navigate, params.sub]);

  // Surface OAuth callback outcomes for the currently-selected platform. The
  // callback redirects to `/settings/messenger/<platform>?installed=ok` (or
  // `?error=...&workspace=...`); we toast success/generic-failure and escalate
  // "already installed by another user" to a modal — the user just
  // round-tripped through OAuth and needs clear next-step guidance.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!selected) return;
    const url = new URL(window.location.href);
    const installed = url.searchParams.get('installed');
    const error = url.searchParams.get('error');
    const workspace = url.searchParams.get('workspace');
    if (!installed && !error) return;

    if (installed && selected === 'slack') {
      message.success(t('messenger.slack.installResult.success'));
    } else if (error === 'already_installed' && selected === 'slack') {
      setBlocked({ name: workspace ?? '', platform: 'slack' });
    } else if (error && selected === 'slack') {
      message.error(
        t('messenger.slack.installResult.failed', {
          reason: getSlackInstallErrorReason(t, error),
        }),
      );
    } else if (installed && selected === 'discord') {
      message.success(t('messenger.discord.installResult.success'));
    } else if (error === 'already_installed' && selected === 'discord') {
      setBlocked({ name: workspace ?? '', platform: 'discord' });
    } else if (error && selected === 'discord') {
      message.error(
        t('messenger.discord.installResult.failed', {
          reason: getDiscordInstallErrorReason(t, error),
        }),
      );
    }

    url.searchParams.delete('installed');
    url.searchParams.delete('error');
    url.searchParams.delete('workspace');
    window.history.replaceState({}, '', url.pathname + (url.search ? `?${url.searchParams}` : ''));
  }, [message, t, selected]);

  const platforms = platformsSWR.data ?? [];
  const selectedMeta = platforms.find((p) => p.id === selected);

  return (
    <div className={styles.page}>
      <Flexbox gap={20}>
        {selected && selectedMeta ? (
          <IntegrationDetail
            appId={selectedMeta.appId}
            botUsername={selectedMeta.botUsername}
            name={selectedMeta.name}
            platform={selected}
            onBack={() => navigate('/settings/messenger')}
          />
        ) : (
          <>
            <Text type="secondary">{t('messenger.subtitle')}</Text>
            {platformsSWR.isLoading ? (
              <Skeleton active paragraph={{ rows: 3 }} title={false} />
            ) : platforms.length === 0 ? (
              <div className={styles.emptyState}>{t('messenger.noPlatformsConfigured')}</div>
            ) : (
              <IntegrationList
                platforms={platforms}
                onSelect={(platform) => navigate(`/settings/messenger/${platform}`)}
              />
            )}
          </>
        )}
      </Flexbox>

      <Modal
        footer={null}
        open={blocked !== null}
        width={480}
        title={
          blocked ? t(`messenger.${blocked.platform}.installBlocked.title` as const) : undefined
        }
        onCancel={() => setBlocked(null)}
      >
        {blocked && (
          <Flexbox align="center" gap={20} style={{ paddingBlock: 16 }}>
            <PlatformAvatar platform={blocked.platform} size={56} />
            <Flexbox align="center" gap={8}>
              <Text strong style={{ fontSize: 16, textAlign: 'center' }}>
                {blocked.name
                  ? t(`messenger.${blocked.platform}.installBlocked.withName` as const, {
                      workspace: blocked.name,
                    })
                  : t(`messenger.${blocked.platform}.installBlocked.withoutName` as const)}
              </Text>
              <Text style={{ textAlign: 'center' }} type="secondary">
                {t(`messenger.${blocked.platform}.installBlocked.suggestion` as const)}
              </Text>
            </Flexbox>
            <Button block size="large" type="primary" onClick={() => setBlocked(null)}>
              {t(`messenger.${blocked.platform}.installBlocked.dismiss` as const)}
            </Button>
          </Flexbox>
        )}
      </Modal>
    </div>
  );
});

MessengerSettings.displayName = 'MessengerSettings';

export default MessengerSettings;
