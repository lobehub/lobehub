'use client';

import { TRASH_RETENTION_DAYS } from '@lobechat/const';
import { Flexbox } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import { useTranslation } from 'react-i18next';

import SettingHeader from '@/features/Settings/features/SettingHeader';

import TrashList from './features/TrashList';

interface PageProps {
  cacheScope?: string | null;
  showSettingHeader?: boolean;
}

const Page = ({ cacheScope = null, showSettingHeader = true }: PageProps) => {
  const { t } = useTranslation('setting');

  return (
    <>
      {showSettingHeader && <SettingHeader title={t('tab.trash')} />}
      <Flexbox gap={12}>
        <Text type={'secondary'}>{t('trash.desc', { days: TRASH_RETENTION_DAYS })}</Text>
        <TrashList cacheScope={cacheScope} />
      </Flexbox>
    </>
  );
};

Page.displayName = 'TrashSettings';

export default Page;
