'use client';

import { Flexbox } from '@lobehub/ui';
import qs from 'query-string';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';

import Title from '../../../../components/Title';
import { useDetailContext } from '../DetailProvider';
import { SkillNavKey } from '../types';
import Platform from './Platform';

const InstallationConfig = memo(() => {
  const { t } = useTranslation('discover');
  const { pathname } = useLocation();
  const installLink = qs.stringifyUrl({
    query: {
      activeTab: SkillNavKey.Installation,
    },
    url: pathname,
  });
  const { identifier, downloadUrl } = useDetailContext();

  return (
    <Flexbox gap={12}>
      <Title more={t('mcp.details.sidebar.moreServerConfig')} moreLink={installLink}>
        {t('skills.details.sidebar.installationConfig')}
      </Title>
      <Platform expandCodeByDefault lite downloadUrl={downloadUrl} identifier={identifier} />
    </Flexbox>
  );
});

export default InstallationConfig;
