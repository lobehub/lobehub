import { Block, Empty, Flexbox } from '@lobehub/ui';
import { Plug2 } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useDetailContext } from '../../DetailProvider';
import PluginItem from './PluginItem';

const Plugin = memo(() => {
  const { t } = useTranslation('discover');
  const { config } = useDetailContext();

  if (!config?.plugins?.length)
    return (
      <Block variant={'outlined'}>
        <Empty
          description={t('assistants.details.capabilities.plugin.desc')}
          descriptionProps={{ fontSize: 14 }}
          icon={Plug2}
        />
      </Block>
    );

  return (
    <Flexbox gap={8}>
      {config?.plugins.map((item) => {
        const identifier =
          typeof item === 'string' ? item : (item as { identifier: string }).identifier;

        return <PluginItem identifier={identifier} key={identifier} />;
      })}
    </Flexbox>
  );
});

export default Plugin;
