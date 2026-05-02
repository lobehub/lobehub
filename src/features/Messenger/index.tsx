'use client';

import { Flexbox, Skeleton, Text } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { memo, useState } from 'react';
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
    padding: 24px;
  `,
}));

const MessengerSettings = memo(() => {
  const { t } = useTranslation('messenger');
  const [selected, setSelected] = useState<MessengerPlatform | null>(null);

  const platformsSWR = useSWR('messenger:availablePlatforms', () =>
    messengerService.availablePlatforms(),
  );

  const platforms = (platformsSWR.data ?? []).map((p) => p.platform as MessengerPlatform);
  const selectedMeta = platformsSWR.data?.find((p) => p.platform === selected);

  return (
    <div className={styles.page}>
      <Flexbox gap={20} style={{ margin: '0 auto', maxWidth: 720 }}>
        {selected ? (
          <IntegrationDetail
            botUsername={selectedMeta?.botUsername}
            platform={selected}
            onBack={() => setSelected(null)}
          />
        ) : (
          <>
            <Flexbox gap={4}>
              <Text strong style={{ fontSize: 20 }}>
                {t('messenger.title')}
              </Text>
              <Text type="secondary">{t('messenger.subtitle')}</Text>
            </Flexbox>
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
