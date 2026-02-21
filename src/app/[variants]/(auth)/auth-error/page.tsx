'use client';

import { SiDiscord } from '@icons-pack/react-simple-icons';
import { SOCIAL_URL } from '@lobechat/business-const';
import { Button, Flexbox, Icon, Text } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { parseAsString, useQueryState } from 'nuqs';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import AuthCard from '@/features/AuthCard';
import Link from '@/libs/next/Link';

const normalizeErrorCode = (code?: string | null) =>
  (code || 'UNKNOWN').trim().toUpperCase().replaceAll('-', '_');

const AuthErrorPage = memo(() => {
  const { t } = useTranslation('authError');
  const [error] = useQueryState('error', parseAsString);

  const code = normalizeErrorCode(error);
  const description = t(`codes.${code}`, { defaultValue: t('codes.UNKNOWN') });

  return (
    <AuthCard
      subtitle={description}
      title={t('title')}
      footer={
        <Flexbox gap={12} justify="center" wrap="wrap">
          <Link href="/signin">
            <Button block size={'large'} type="primary">
              {t('actions.retry')}
            </Button>
          </Link>
          <Link href="/">
            <Button block size={'large'}>
              {t('actions.home')}
            </Button>
          </Link>
          <Link href={SOCIAL_URL.discord} rel="noopener noreferrer" target="_blank">
            <Button block icon={<Icon fill={cssVar.colorText} icon={SiDiscord} />} type="text">
              {t('actions.discord')}
            </Button>
          </Link>
        </Flexbox>
      }
    >
      <Text style={{ fontFamily: cssVar.fontFamilyCode }} type={'secondary'}>
        ErrorCode: {error || 'UNKNOWN'}
      </Text>
    </AuthCard>
  );
});

AuthErrorPage.displayName = 'AuthErrorPage';

export default AuthErrorPage;
