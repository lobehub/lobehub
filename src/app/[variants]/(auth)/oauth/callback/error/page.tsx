'use client';

import { Button, Flexbox, FluentEmoji, Highlighter, Text } from '@lobehub/ui';
import { Result } from 'antd';
import { parseAsString, useQueryState } from 'nuqs';
import React, { memo } from 'react';
import { useTranslation } from 'react-i18next';

import Link from '@/libs/next/Link';

const FailedPage = memo(() => {
  const { t } = useTranslation('oauth');
  const [reason] = useQueryState('reason');
  const [errorMessage] = useQueryState<string>('errorMessage', parseAsString);

  return (
    <Result
      icon={<FluentEmoji emoji={'🥵'} size={96} type={'anim'} />}
      status="error"
      extra={
        <Link href="/public">
          <Button block size={'large'} style={{ minWidth: 240 }}>
            {t('error.backToHome')}
          </Button>
        </Link>
      }
      subTitle={
        <Flexbox gap={8}>
          <Text fontSize={16} type="secondary">
            {t('error.desc', {
              reason: t(`error.reason.${reason}` as any, { defaultValue: reason }),
            })}
          </Text>
          {!!errorMessage && <Highlighter language={'log'}>{errorMessage}</Highlighter>}
        </Flexbox>
      }
      title={
        <Text fontSize={32} weight={'bold'}>
          {t('error.title')}
        </Text>
      }
    />
  );
});

FailedPage.displayName = 'FailedPage';

export default FailedPage;
