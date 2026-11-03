import { type EmptyProps } from '@lobehub/ui';
import { Center, Empty } from '@lobehub/ui';
import { Cloud } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

interface ProviderEmptyProps extends Omit<EmptyProps, 'icon'> {
  search?: boolean;
}

const ProviderEmpty = memo<ProviderEmptyProps>(({ search, ...rest }) => {
  const { t } = useTranslation('discover');

  return (
    <Center height="100%" style={{ minHeight: '50vh' }} width="100%">
      <Empty
        description={search ? t('providers.empty.search') : t('providers.empty.description')}
        icon={Cloud}
        title={search ? undefined : t('providers.empty.title')}
        type={search ? 'default' : 'page'}
        descriptionProps={{
          fontSize: 14,
        }}
        style={{
          maxWidth: 400,
        }}
        {...rest}
      />
    </Center>
  );
});

ProviderEmpty.displayName = 'ProviderEmpty';

export default ProviderEmpty;
