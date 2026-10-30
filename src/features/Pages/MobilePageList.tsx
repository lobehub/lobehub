'use client';

import { Flexbox, Text } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import NavHeader from '@/features/NavHeader';

import Body from './PageLayout/Body';
import AddButton from './PageLayout/Header/AddButton';

/**
 * Mobile `/page`: the desktop index is a "create a page" placeholder beside the
 * sidebar list. Mobile has no sidebar, so the list itself is the page.
 */
const MobilePageList = memo(() => {
  const { t } = useTranslation('common');

  return (
    <Flexbox height={'100%'} width={'100%'}>
      <NavHeader
        showTogglePanelButton
        left={<Text weight={500}>{t('tab.pages')}</Text>}
        right={<AddButton />}
      />
      <Flexbox flex={1} paddingBlock={8} style={{ overflowY: 'auto' }}>
        <Body />
      </Flexbox>
    </Flexbox>
  );
});

MobilePageList.displayName = 'MobilePageList';

export default MobilePageList;
