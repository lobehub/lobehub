import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useDetailContext } from '../../DetailProvider';
import Block from './Block';
import Knowledge from './Knowledge';
import Plugins from './Plugins';

const Capabilities = memo(() => {
  const { t } = useTranslation('discover');
  const { pluginCount, knowledgeCount } = useDetailContext();

  return (
    <Flexbox gap={64}>
      <Block
        count={pluginCount || 0}
        desc={t('assistants.details.capabilities.plugin.desc')}
        id={'tools'}
        title={t('assistants.details.capabilities.plugin.title')}
      >
        <Plugins />
      </Block>

      <Block
        count={knowledgeCount || 0}
        desc={t('assistants.details.capabilities.knowledge.desc')}
        id={'prompts'}
        title={t('assistants.details.capabilities.knowledge.title')}
      >
        <Knowledge />
      </Block>
    </Flexbox>
  );
});

export default Capabilities;
