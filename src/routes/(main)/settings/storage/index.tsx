'use client';

import { Flexbox, FormGroup, Skeleton } from '@lobehub/ui';
import { useTranslation } from 'react-i18next';

import SettingHeader from '@/routes/(main)/settings/features/SettingHeader';
import { useServerConfigStore } from '@/store/serverConfig';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';

import Advanced from './features/Advanced';

interface PageProps {
  showSettingHeader?: boolean;
}

const Page = ({ showSettingHeader = true }: PageProps) => {
  const { t } = useTranslation('setting');
  const serverConfigInit = useServerConfigStore((s) => s.serverConfigInit);
  const isUserLoaded = useUserStore(authSelectors.isLoaded);

  const isLoading = !serverConfigInit || !isUserLoaded;

  return (
    <>
      {showSettingHeader && <SettingHeader title={t('tab.storage')} />}
      <Flexbox style={{ display: isLoading ? 'flex' : 'none' }}>
        <FormGroup collapsible={false} title={t('storage.actions.title')} variant="filled">
          <Skeleton active paragraph={{ rows: 4 }} />
        </FormGroup>
      </Flexbox>
      <Flexbox style={{ display: isLoading ? 'none' : 'flex' }}>
        <Advanced />
      </Flexbox>
    </>
  );
};

export default Page;
