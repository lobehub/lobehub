'use client';

import { SiDiscord } from '@icons-pack/react-simple-icons';
import { SOCIAL_URL } from '@lobechat/business-const';
import { Flexbox, Icon, Text } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { cssVar } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';

import AuthCard from '@/features/AuthCard';

const normalizeErrorCode = (code?: string | null) =>
  (code || 'UNKNOWN').trim().toUpperCase().replaceAll('-', '_');

const AuthErrorPage = memo(() => {
  const { t } = useTranslation('authError');
  const [searchParams] = useSearchParams();
  const error = searchParams.get('error');

  const code = normalizeErrorCode(error);
  const description = t(`codes.${code}`, { defaultValue: t('codes.UNKNOWN') });

  return (
    <AuthCard
      subtitle={description}
      title={t('title')}
      footer={
        <Flexbox gap={12} justify="center" wrap="wrap">
          <Link to="/signin">
            <Button block size={'large'} type="primary">
              {t('actions.retry')}
            </Button>
          </Link>
          <a href={'/'}>
            <Button block size={'large'}>
              {t('actions.home')}
            </Button>
          </a>
          <a href={SOCIAL_URL.discord} rel="noopener noreferrer" target="_blank">
            <Button block icon={<Icon fill={cssVar.colorText} icon={SiDiscord} />} type="text">
              {t('actions.discord')}
            </Button>
          </a>
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
