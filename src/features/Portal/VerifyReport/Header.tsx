import { DESKTOP_HEADER_ICON_SMALL_SIZE } from '@lobechat/const';
import { ActionIcon } from '@lobehub/ui';
import { ExternalLink } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { openTrustedExternalUrl } from '@/utils/openTrustedExternalUrl';

import Header from '../components/Header';
import Title from './Title';
import { useVerifyReportUrl } from './useReportUrl';

const VerifyReportHeader = memo<{ onClose?: () => void }>(({ onClose }) => {
  const { t } = useTranslation('verify');
  const { externalUrl, standalone } = useVerifyReportUrl();

  return (
    <Header
      title={<Title />}
      rightExtra={
        // A run outside any acceptance has no page to open in the browser.
        standalone ? undefined : (
          <ActionIcon
            disabled={!externalUrl}
            icon={ExternalLink}
            size={DESKTOP_HEADER_ICON_SMALL_SIZE}
            title={t('report.actions.openInBrowser')}
            onClick={() => {
              if (!externalUrl) return;
              openTrustedExternalUrl(externalUrl);
            }}
          />
        )
      }
      onClose={onClose}
    />
  );
});

export default VerifyReportHeader;
