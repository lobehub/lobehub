import { DESKTOP_HEADER_ICON_SMALL_SIZE } from '@lobechat/const';
import { ActionIcon } from '@lobehub/ui/base-ui';
import { ExternalLink } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { openTrustedExternalUrl } from '@/utils/openTrustedExternalUrl';

import Header from '../components/Header';
import Title from './Title';
import { useAcceptancePageUrl } from './usePageUrl';

const AcceptanceHeader = memo(() => {
  const { t } = useTranslation('verify');
  const { externalUrl } = useAcceptancePageUrl();

  return (
    <Header
      paddingInline={24}
      title={<Title />}
      rightExtra={
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
      }
    />
  );
});

export default AcceptanceHeader;
