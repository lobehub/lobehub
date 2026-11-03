import { Center, createStaticStyles, Spin } from '@lobehub/ui';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';

import NotFound from '@/components/404';
import IntegrationsSettings from '@/features/Integrations';
import IntegrationsLayout from '@/features/Integrations/Layout';
import IntegrationsOverviewSkeleton from '@/features/Integrations/OverviewSkeleton';
import SettingHeader from '@/features/Settings/features/SettingHeader';
import { useUserStore } from '@/store/user';
import { labPreferSelectors, preferenceSelectors } from '@/store/user/selectors';

const styles = createStaticStyles(({ css }) => ({
  header: css`
    width: 100%;
    max-width: 760px;
    margin-inline: auto;
  `,
}));

interface PageProps {
  showSettingHeader?: boolean;
}

const Page = ({ showSettingHeader = true }: PageProps) => {
  const { t } = useTranslation('integration');
  const params = useParams<{ sub?: string }>();
  const [isPreferenceInit, enableIntegrations] = useUserStore((s) => [
    preferenceSelectors.isPreferenceInit(s),
    labPreferSelectors.enableIntegrations(s),
  ]);
  // The directory carries the page header; an integration page draws its own hero.
  const showHeader = showSettingHeader && !params.sub;

  // Labs alpha: a deep link with the flag off is a missing page, not a leak.
  if (!enableIntegrations && isPreferenceInit) return <NotFound />;

  return (
    <>
      {showHeader && (
        <div className={styles.header}>
          <SettingHeader description={t('overview.description')} title={t('overview.title')} />
        </div>
      )}
      {isPreferenceInit ? (
        <IntegrationsSettings />
      ) : (
        // Keep the header and reading-width column while the flag resolves. The
        // directory has a known card layout; an integration page's hero does not.
        <IntegrationsLayout>
          {params.sub ? (
            <Center paddingBlock={48}>
              <Spin size={'large'} />
            </Center>
          ) : (
            <IntegrationsOverviewSkeleton />
          )}
        </IntegrationsLayout>
      )}
    </>
  );
};

export default Page;
