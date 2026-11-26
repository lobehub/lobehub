import { ActionIcon } from '@lobehub/ui';
import { ExternalLink } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useHeaderActionSize } from '@/styles/density';
import { openTrustedExternalUrl } from '@/utils/openTrustedExternalUrl';

import Header from '../components/Header';
import Title from './Title';
import { useAcceptancePageUrl } from './usePageUrl';

const AcceptanceHeader = memo<{ onClose?: () => void }>(({ onClose }) => {
  const headerActionSize = useHeaderActionSize(true);
  const { t } = useTranslation('verify');
  const { externalUrl } = useAcceptancePageUrl();

  return (
    <Header
      title={<Title />}
      rightExtra={
        <ActionIcon
          disabled={!externalUrl}
          icon={ExternalLink}
          size={headerActionSize}
          title={t('report.actions.openInBrowser')}
          onClick={() => {
            if (!externalUrl) return;
            openTrustedExternalUrl(externalUrl);
          }}
        />
      }
      onClose={onClose}
    />
  );
});

export default AcceptanceHeader;
