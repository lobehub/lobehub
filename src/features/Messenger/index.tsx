'use client';

import { Flexbox, Skeleton, Text } from '@lobehub/ui';
import { App } from 'antd';
import { createStaticStyles } from 'antd-style';
import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

import { messengerService } from '@/services/messenger';

import { type MessengerPlatform } from './constants';
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

  const platformsSWR = useSWR('messenger:availablePlatforms', () =>
    messengerService.availablePlatforms(),
  );

  // Surface Slack OAuth callback outcomes (success / blocked / failed) as a
  // toast and scrub the query params so a refresh doesn't keep firing.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    const installed = url.searchParams.get('slack_installed');
    const error = url.searchParams.get('slack_error');
    if (!installed && !error) return;

    if (installed) {
      message.success(t('messenger.slack.installResult.success'));
    } else if (error === 'already_installed') {
      message.warning(t('messenger.slack.installResult.alreadyInstalled'));
    } else if (error) {
      message.error(t('messenger.slack.installResult.failed', { reason: error }));
    }

    url.searchParams.delete('slack_installed');
    url.searchParams.delete('slack_error');
    window.history.replaceState({}, '', url.pathname + (url.search ? `?${url.searchParams}` : ''));
  }, [message, t]);

  const platforms = (platformsSWR.data ?? []).map((p) => p.platform as MessengerPlatform);
  const selectedMeta = platformsSWR.data?.find((p) => p.platform === selected);

  return (
    <div className={styles.page}>
      <Flexbox gap={20}>
        {selected ? (
          <IntegrationDetail
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
    </div>
  );
});

MessengerSettings.displayName = 'MessengerSettings';

export default MessengerSettings;
