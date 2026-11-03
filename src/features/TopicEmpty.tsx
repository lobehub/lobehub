import { type EmptyProps } from '@lobehub/ui';
import { Center, Empty } from '@lobehub/ui';
import { MessageSquareText } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

interface TopicEmptyProps extends Omit<EmptyProps, 'icon'> {
  search?: boolean;
}

const TopicEmpty = memo<TopicEmptyProps>(({ search, ...rest }) => {
  const { t } = useTranslation('topic');

  return (
    <Center height="100%" style={{ minHeight: '50vh' }} width="100%">
      <Empty
        description={search ? t('searchResultEmpty') : t('guide.desc')}
        icon={MessageSquareText}
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

TopicEmpty.displayName = 'TopicEmpty';

export default TopicEmpty;
