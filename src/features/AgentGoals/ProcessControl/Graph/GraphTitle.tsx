import { Text } from '@lobehub/ui';
import { useTranslation } from 'react-i18next';

import { useDensityTokens } from '@/styles/density';

const GraphTitle = () => {
  const { t } = useTranslation('chat');
  const { pageTitleFontSize } = useDensityTokens();

  return (
    <Text fontSize={pageTitleFontSize} weight={600}>
      {t('goalProcess.graph.title')}
    </Text>
  );
};

export default GraphTitle;
