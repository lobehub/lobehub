'use client';

import { Button, Flexbox, FluentEmoji } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { MAX_WIDTH } from '@/const/layoutTokens';

const NotFound = memo(() => {
  const { t } = useTranslation('error');
  return (
    <Flexbox align={'center'} justify={'center'} style={{ minHeight: '100%', width: '100%' }}>
      <h1
        style={{
          filter: 'blur(8px)',
          fontSize: `min(${MAX_WIDTH / 3}px, 50vw)`,
          fontWeight: 'bolder',
          margin: 0,
          opacity: 0.12,
          position: 'absolute',
          zIndex: 0,
        }}
      >
        404
      </h1>
      <FluentEmoji emoji={'👀'} size={64} />
      <h2 style={{ fontWeight: 'bold', marginTop: '1em', textAlign: 'center' }}>
        {t('notFound.title')}
      </h2>
      <div style={{ lineHeight: '1.8', marginBottom: '2em', textAlign: 'center' }}>
        <div>{t('notFound.desc')}</div>
        <div style={{ marginTop: '0.5em' }}>{t('notFound.check')}</div>
      </div>

      <Button onClick={() => (window.location.href = '/')} type={'primary'}>
        {t('notFound.backHome')}
      </Button>
    </Flexbox>
  );
});

NotFound.displayName = 'NotFound';

export default NotFound;
