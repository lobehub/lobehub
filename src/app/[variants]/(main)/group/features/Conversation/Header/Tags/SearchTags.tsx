import { Flexbox, Icon, Tag } from '@lobehub/ui';
import { Globe } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

const SearchTag = memo(() => {
  const { t } = useTranslation('chat');

  return (
    <Flexbox height={22}>
      <Tag>
        {<Icon icon={Globe} />}
        <div>{t('search.title')}</div>
      </Tag>
    </Flexbox>
  );
});

export default SearchTag;
