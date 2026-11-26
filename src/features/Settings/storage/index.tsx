'use client';

import { Flexbox } from '@lobehub/ui';
import { useTranslation } from 'react-i18next';

import StorageSkeleton from '@/components/Skeleton/Settings/tabs/Storage';
import SettingHeader from '@/features/Settings/features/SettingHeader';
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
      {/* Same groups the route and chunk fallbacks draw. The wrapper keeps the
          actions form and account deletion out of the container's 36px gap. */}
      {isLoading ? (
        <StorageSkeleton.Body />
      ) : (
        <Flexbox>
          <Advanced />
        </Flexbox>
      )}
    </>
  );
};

export default Page;
