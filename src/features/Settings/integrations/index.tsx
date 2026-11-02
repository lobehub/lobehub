import * as stylex from '@stylexjs/stylex';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';

import IntegrationsSettings from '@/features/Integrations';
import SettingHeader from '@/features/Settings/features/SettingHeader';

const styles = stylex.create({
  header: { width: '100%', maxWidth: '760px', marginInline: 'auto' },
});

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
        <div {...stylex.props(styles.header)}>
          <SettingHeader description={t('overview.description')} title={t('overview.title')} />
        </div>
      )}
      <IntegrationsSettings />
    </>
  );
};

export default Page;
