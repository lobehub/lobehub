import { type EmptyProps } from '@lobehub/ui';
import { Center, Empty } from '@lobehub/ui';
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
        icon={Cpu}
        title={search ? undefined : t('models.empty.title')}
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

ModelEmpty.displayName = 'ModelEmpty';

export default ModelEmpty;
