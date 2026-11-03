import { type EmptyProps } from '@lobehub/ui';
import { Center, Empty } from '@lobehub/ui';
import { FileText } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

interface PageEmptyProps extends Omit<EmptyProps, 'icon'> {
  search?: boolean;
}

const PageEmpty = memo<PageEmptyProps>(({ search, ...rest }) => {
  const { t } = useTranslation('file');

  return (
    <Center height="100%" style={{ minHeight: '50vh' }} width="100%">
      <Empty
        description={search ? t('pageList.noResults') : t('pageList.empty')}
        icon={FileText}
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

PageEmpty.displayName = 'PageEmpty';

export default PageEmpty;
