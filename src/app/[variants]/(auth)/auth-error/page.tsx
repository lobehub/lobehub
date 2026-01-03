'use client';

import { SiDiscord } from '@icons-pack/react-simple-icons';
import { Alert, Button, Flexbox, Icon } from '@lobehub/ui';
import Link from 'next/link';
import { parseAsString, useQueryState } from 'nuqs';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import AuthCard from '@/features/AuthCard';

const DISCORD_URL = 'https://discord.gg/AYFPHvv2jT';

const normalizeErrorCode = (code?: string | null) =>
  (code || 'UNKNOWN').trim().toUpperCase().replaceAll('-', '_');

const AuthErrorPage = memo(() => {
  const { t } = useTranslation('authError');
  const [error] = useQueryState('error', parseAsString);

  const code = normalizeErrorCode(error);
  const description = t(`codes.${code}`, { defaultValue: t('codes.UNKNOWN') });

  return (
    <AuthCard
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
          <Link href={DISCORD_URL} rel="noopener noreferrer" target="_blank">
            <Button block icon={<Icon icon={SiDiscord} />} type="text">
              {t('actions.discord')}
            </Button>
          </Link>
        </Flexbox>
      }
      subtitle={description}
      title={t('title')}
    >
      <Alert title={error || 'UNKNOWN'} type={'error'} />
    </AuthCard>
  );
});

AuthErrorPage.displayName = 'AuthErrorPage';

export default AuthErrorPage;
