import { Flexbox } from '@lobehub/ui';
import qs from 'query-string';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';

import { getRecommendedDeployment } from '@/features/MCP/utils';
import Platform from '@/features/MCPPluginDetail/Deployment/Platform';
import { useDetailContext } from '@/features/MCPPluginDetail/DetailProvider';
import { McpNavKey } from '@/types/discover';

import Title from '../../../../features/Title';

const ServerConfig = memo(() => {
  const { t } = useTranslation('discover');
  const { pathname } = useLocation();
  const installLink = qs.stringifyUrl({
    query: {
      activeTab: McpNavKey.Deployment,
    },
    url: pathname,
  });
  const { deploymentOptions = [], identifier } = useDetailContext();
  const recommendedDeployment = getRecommendedDeployment(deploymentOptions);

  return (
    <Flexbox gap={16}>
      <Title more={t('mcp.details.sidebar.moreServerConfig')} moreLink={installLink}>
        {t('mcp.details.sidebar.serverConfig')}
      </Title>
      <Platform lite connection={recommendedDeployment?.connection} identifier={identifier} />
    </Flexbox>
  );
});

export default ServerConfig;
