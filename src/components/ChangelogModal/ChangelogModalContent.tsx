'use client';

import { Center, Flexbox, ScrollArea } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

import { changelogKeys } from '@/libs/swr/keys';
import { lambdaClient } from '@/libs/trpc/client';

import ChangelogContent from './ChangelogContent';

const SCROLL_HEIGHT = 'min(80vh, 760px)';

const ChangelogModalContent = memo(() => {
  const { t } = useTranslation('common');
  const { data, isLoading } = useSWR(changelogKeys.modalIndex(), () =>
    lambdaClient.changelog.getIndex.query(),
  );

  return (
    <ScrollArea scrollFade style={{ height: SCROLL_HEIGHT }}>
      {isLoading || !data || data.length === 0 ? (
        <Center style={{ height: SCROLL_HEIGHT }}>{t('loading')}</Center>
      ) : (
        <Flexbox gap={16} padding={16} style={{ width: '100%' }}>
          <ChangelogContent data={data} />
        </Flexbox>
      )}
    </ScrollArea>
  );
});

ChangelogModalContent.displayName = 'ChangelogModalContent';

export default ChangelogModalContent;
