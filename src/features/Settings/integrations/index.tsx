import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';

import IntegrationsSettings from '@/features/Integrations';
import SettingHeader from '@/features/Settings/features/SettingHeader';

interface PageProps {
  showSettingHeader?: boolean;
}

const Page = ({ showSettingHeader = true }: PageProps) => {
  const { t } = useTranslation('integration');
  const params = useParams<{ sub?: string }>();
  // The directory carries the page header; an integration page draws its own hero.
  const showHeader = showSettingHeader && !params.sub;
  return (
    <>
      {showHeader && (
        <SettingHeader description={t('overview.description')} title={t('overview.title')} />
      )}
      <IntegrationsSettings />
    </>
  );
};

export default Page;
