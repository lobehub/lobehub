'use client';

import { Button, Flexbox, Text } from '@lobehub/ui';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { notification } from '@/components/AntdStaticMethods';
import { useUserStore } from '@/store/user';
import { authSelectors, userProfileSelectors } from '@/store/user/selectors';

import { labelStyle, rowStyle } from './ProfileRow';

interface PasswordRowProps {
  mobile?: boolean;
}

const PasswordRow = ({ mobile }: PasswordRowProps) => {
  const { t } = useTranslation('auth');
  const userProfile = useUserStore(userProfileSelectors.userProfile);
  const hasPasswordAccount = useUserStore(authSelectors.hasPasswordAccount);
  const [sending, setSending] = useState(false);

  const handleChangePassword = useCallback(async () => {
    if (!userProfile?.email) return;

    try {
      setSending(true);
      const { requestPasswordReset } = await import('@/libs/better-auth/auth-client');
      await requestPasswordReset({
        email: userProfile.email,
        redirectTo: `/reset-password?email=${encodeURIComponent(userProfile.email)}`,
      });
      notification.success({
        message: t('profile.resetPasswordSent'),
      });
    } catch (error) {
      console.error('Failed to send reset password email:', error);
      notification.error({
        message: t('profile.resetPasswordError'),
      });
    } finally {
      setSending(false);
    }
  }, [userProfile?.email, t]);

  if (mobile) {
    return (
      <Flexbox horizontal align="center" gap={12} justify="space-between" style={rowStyle}>
        <Text strong>{t('profile.password')}</Text>
        <Button loading={sending} size="small" onClick={handleChangePassword}>
          {hasPasswordAccount ? t('profile.changePassword') : t('profile.setPassword')}
        </Button>
      </Flexbox>
    );
  }

  return (
    <Flexbox horizontal align="center" gap={24} style={rowStyle}>
      <Text style={labelStyle}>{t('profile.password')}</Text>
      <Flexbox align="flex-end" style={{ flex: 1 }}>
        <Button loading={sending} size="small" onClick={handleChangePassword}>
          {hasPasswordAccount ? t('profile.changePassword') : t('profile.setPassword')}
        </Button>
      </Flexbox>
    </Flexbox>
  );
};

export default PasswordRow;
