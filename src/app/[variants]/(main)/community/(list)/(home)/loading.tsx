import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import ListLoading from '@/app/[variants]/(main)/community/components/ListLoading';
import Title from '@/app/[variants]/(main)/community/components/Title';

const Loading = memo(() => {
  const { t } = useTranslation('discover');

  return (
    <>
      <Title more={t('home.more')} moreLink={'/community/agent'}>
        {t('home.featuredAssistants')}
      </Title>
      <ListLoading length={8} rows={4} />
      <div />
      <Title more={t('home.more')} moreLink={'/community/mcp'}>
        {t('home.featuredTools')}
      </Title>
      <ListLoading length={8} rows={4} />
    </>
  );
});

export default Loading;
