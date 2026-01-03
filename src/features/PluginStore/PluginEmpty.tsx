import { Center, Empty, type EmptyProps } from '@lobehub/ui';
import { Plug2 } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

interface PluginEmptyProps extends Omit<EmptyProps, 'icon'> {
  search?: boolean;
}

const PluginEmpty = memo<PluginEmptyProps>(({ search, ...rest }) => {
  const { t } = useTranslation('plugin');

  return (
    <Center height="100%" style={{ minHeight: '50vh' }} width="100%">
      <Empty
        description={search ? t('empty.search') : t('empty.description')}
        descriptionProps={{
          fontSize: 14,
        }}
        icon={Plug2}
        style={{
          maxWidth: 400,
        }}
        {...rest}
      />
    </Center>
  );
});

PluginEmpty.displayName = 'PluginEmpty';

export default PluginEmpty;
