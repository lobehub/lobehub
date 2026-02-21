import { type EmptyProps } from '@lobehub/ui';
import { Center, Empty } from '@lobehub/ui';
import { Bot } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

interface AssistantEmptyProps extends Omit<EmptyProps, 'icon'> {
  search?: boolean;
}

const AssistantEmpty = memo<AssistantEmptyProps>(({ search, ...rest }) => {
  const { t } = useTranslation('discover');

  return (
    <Center height="100%" style={{ minHeight: '50vh' }} width="100%">
      <Empty
        description={search ? t('assistants.empty.search') : t('assistants.empty.description')}
        icon={Bot}
        title={search ? undefined : t('assistants.empty.title')}
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

AssistantEmpty.displayName = 'AssistantEmpty';

export default AssistantEmpty;
