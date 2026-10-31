'use client';

import { TRASH_RETENTION_DAYS } from '@lobechat/const';
import { Flexbox, Text } from '@lobehub/ui';
import { useTranslation } from 'react-i18next';

import SettingHeader from '@/features/Settings/features/SettingHeader';

import TrashList from './features/TrashList';

interface PageProps {
  /** Workspace bin: a public side shared by every member and a private side of one's own. */
  isWorkspace?: boolean;
  showSettingHeader?: boolean;
}

const Page = ({ isWorkspace, showSettingHeader = true }: PageProps) => {
  const { t } = useTranslation('setting');

  return (
    <>
      {showSettingHeader && <SettingHeader title={t('tab.trash')} />}
      <Flexbox gap={12}>
        <Text type={'secondary'}>
          {t(isWorkspace ? 'trash.workspaceDesc' : 'trash.desc', { days: TRASH_RETENTION_DAYS })}
        </Text>
        <TrashList isWorkspace={isWorkspace} />
      </Flexbox>
    </>
  );
};

Page.displayName = 'TrashSettings';

export default Page;
