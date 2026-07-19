'use client';

import { Alert, Flexbox, Icon, Text } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { ExternalLinkIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

interface ThirdPartyNoticeProps {
  developerName?: string;
  policyUri?: string;
}

const ThirdPartyNotice = memo<ThirdPartyNoticeProps>(({ developerName, policyUri }) => {
  const { t } = useTranslation('oauth');

  const developer = developerName || t('consent.thirdParty.unknownDeveloper');

  return (
    <Flexbox gap={8} width={'100%'}>
      <Text type={'secondary'}>
        {t('consent.thirdParty.developedBy', { developerName: developer })}
      </Text>
      <Alert showIcon description={t('consent.thirdParty.notice')} type={'warning'} />
      {policyUri && (
        <a href={policyUri} rel={'noreferrer'} target={'_blank'}>
          <Flexbox horizontal align={'center'} gap={4}>
            <Text style={{ color: cssVar.colorLink }}>{t('consent.thirdParty.privacyPolicy')}</Text>
            <Icon icon={ExternalLinkIcon} style={{ color: cssVar.colorLink, fontSize: 14 }} />
          </Flexbox>
        </a>
      )}
    </Flexbox>
  );
});

ThirdPartyNotice.displayName = 'ThirdPartyNotice';

export default ThirdPartyNotice;
