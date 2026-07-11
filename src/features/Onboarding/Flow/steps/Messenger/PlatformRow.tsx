'use client';

import { Flexbox, Skeleton, Tag, Text } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { PlatformBrandIcon } from '@/features/Messenger/constants';

import { styles } from './style';
import type { MessengerPlatformRow } from './useMessengerPlatforms';

export const PlatformRowSkeleton = memo(() => (
  <Flexbox horizontal align={'center'} className={styles.row} gap={12} justify={'space-between'}>
    <Flexbox horizontal align={'center'} flex={1} gap={12}>
      <Skeleton.Avatar active shape={'square'} size={36} />
      <Skeleton.Button active size={'small'} style={{ height: 20, width: 96 }} />
    </Flexbox>
    <Skeleton.Button active size={'small'} style={{ width: 72 }} />
  </Flexbox>
));
PlatformRowSkeleton.displayName = 'MessengerPlatformRowSkeleton';

const PlatformRow = memo<MessengerPlatformRow>(({ connected, href, id }) => {
  const { t } = useTranslation('onboarding');

  return (
    <Flexbox horizontal align={'center'} className={styles.row} gap={12} justify={'space-between'}>
      <Flexbox horizontal align={'center'} flex={1} gap={12}>
        <div className={styles.rowIcon}>
          <PlatformBrandIcon platform={id} size={20} />
        </div>
        <Text className={styles.rowLabel}>{t(`flow.steps.messenger.platforms.${id}`)}</Text>
      </Flexbox>
      {connected ? (
        <Tag color={'success'}>{t('flow.steps.messenger.connected')}</Tag>
      ) : (
        <Button
          disabled={!href}
          href={href}
          rel={'noopener noreferrer'}
          shape={'round'}
          size={'small'}
          target={'_blank'}
        >
          {t('flow.steps.messenger.connect')}
        </Button>
      )}
    </Flexbox>
  );
});

PlatformRow.displayName = 'MessengerPlatformRow';

export default PlatformRow;
