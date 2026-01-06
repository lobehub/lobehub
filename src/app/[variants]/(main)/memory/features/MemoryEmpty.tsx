import { Center, Empty, type EmptyProps } from '@lobehub/ui';
import { BrainCircuitIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

const MemoryEmpty = memo<EmptyProps & { search?: boolean }>(({ search, title, ...rest }) => {
  const { t } = useTranslation('memory');
  return (
    <Center height="100%" style={{ minHeight: '50vh' }} width="100%">
      <Empty
        description={search ? t('empty.search') : t('empty.description')}
        descriptionProps={{
          fontSize: 14,
        }}
        icon={BrainCircuitIcon}
        style={{
          maxWidth: 400,
        }}
        title={search ? undefined : title || t('empty.title')}
        type={search ? 'default' : 'page'}
        {...rest}
      />
    </Center>
  );
});

export default MemoryEmpty;
