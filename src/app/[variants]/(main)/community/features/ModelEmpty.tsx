import { Center, Empty, type EmptyProps } from '@lobehub/ui';
import { Cpu } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

interface ModelEmptyProps extends Omit<EmptyProps, 'icon'> {
  search?: boolean;
}

const ModelEmpty = memo<ModelEmptyProps>(({ search, ...rest }) => {
  const { t } = useTranslation('discover');

  return (
    <Center height="100%" style={{ minHeight: '50vh' }} width="100%">
      <Empty
        description={search ? t('models.empty.search') : t('models.empty.description')}
        descriptionProps={{
          fontSize: 14,
        }}
        icon={Cpu}
        style={{
          maxWidth: 400,
        }}
        title={search ? undefined : t('models.empty.title')}
        type={search ? 'default' : 'page'}
        {...rest}
      />
    </Center>
  );
});

ModelEmpty.displayName = 'ModelEmpty';

export default ModelEmpty;
