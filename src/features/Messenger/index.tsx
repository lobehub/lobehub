'use client';

import { Button, Flexbox, Modal, Skeleton, Text } from '@lobehub/ui';
import { App } from 'antd';
import { createStaticStyles } from 'antd-style';
import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

import { messengerService } from '@/services/messenger';

import { type MessengerPlatform, PlatformAvatar } from './constants';
import { getSlackInstallErrorReason } from './i18n';
import IntegrationDetail from './IntegrationDetail';
import IntegrationList from './IntegrationList';

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
  const [selected, setSelected] = useState<MessengerPlatform | null>(null);
  // Workspace name from `?slack_workspace=...`. When set, render the takeover
  // explainer modal — toast is too transient for a flow where the user just
  // round-tripped through Slack OAuth and needs clear next-step guidance.
  const [blockedWorkspace, setBlockedWorkspace] = useState<string | null>(null);

  const platformsSWR = useSWR('messenger:availablePlatforms', () =>
    messengerService.availablePlatforms(),
  );

  // Surface Slack OAuth callback outcomes. Success / generic failure stay as
  // toasts; the "already installed by another user" case is escalated to a
  // modal because the user needs to understand what happened and what to do
  // next.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    const installed = url.searchParams.get('slack_installed');
    const error = url.searchParams.get('slack_error');
    const workspace = url.searchParams.get('slack_workspace');
    if (!installed && !error) return;

    if (installed) {
      message.success(t('messenger.slack.installResult.success'));
    } else if (error === 'already_installed') {
      // Empty string sentinel = open modal even when workspace name is unknown.
      setBlockedWorkspace(workspace ?? '');
    } else if (error) {
      message.error(
        t('messenger.slack.installResult.failed', {
          reason: getSlackInstallErrorReason(t, error),
        }),
      );
    }

    url.searchParams.delete('slack_installed');
    url.searchParams.delete('slack_error');
    url.searchParams.delete('slack_workspace');
    window.history.replaceState({}, '', url.pathname + (url.search ? `?${url.searchParams}` : ''));
  }, [message, t]);

  const platforms = (platformsSWR.data ?? []).map((p) => p.platform as MessengerPlatform);
  const selectedMeta = platformsSWR.data?.find((p) => p.platform === selected);

  return (
    <div className={styles.page}>
      <Flexbox gap={20}>
        {selected ? (
          <IntegrationDetail
            appId={selectedMeta?.appId}
            botUsername={selectedMeta?.botUsername}
            platform={selected}
            onBack={() => setSelected(null)}
          />
        ) : (
          <>
            <Text type="secondary">{t('messenger.subtitle')}</Text>
            {platformsSWR.isLoading ? (
              <Skeleton active paragraph={{ rows: 3 }} title={false} />
            ) : platforms.length === 0 ? (
              <div className={styles.emptyState}>{t('messenger.noPlatformsConfigured')}</div>
            ) : (
              <IntegrationList platforms={platforms} onSelect={setSelected} />
            )}
          </>
        )}
      </Flexbox>

      <Modal
        footer={null}
        open={blockedWorkspace !== null}
        title={t('messenger.slack.installBlocked.title')}
        width={480}
        onCancel={() => setBlockedWorkspace(null)}
      >
        <Flexbox align="center" gap={20} style={{ paddingBlock: 16 }}>
          <PlatformAvatar platform="slack" size={56} />
          <Flexbox align="center" gap={8}>
            <Text strong style={{ fontSize: 16, textAlign: 'center' }}>
              {blockedWorkspace
                ? t('messenger.slack.installBlocked.withName', { workspace: blockedWorkspace })
                : t('messenger.slack.installBlocked.withoutName')}
            </Text>
            <Text style={{ textAlign: 'center' }} type="secondary">
              {t('messenger.slack.installBlocked.suggestion')}
            </Text>
          </Flexbox>
          <Button block size="large" type="primary" onClick={() => setBlockedWorkspace(null)}>
            {t('messenger.slack.installBlocked.dismiss')}
          </Button>
        </Flexbox>
      </Modal>
    </div>
  );
});

MessengerSettings.displayName = 'MessengerSettings';

export default MessengerSettings;
