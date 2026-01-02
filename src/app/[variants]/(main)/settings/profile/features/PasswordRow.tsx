'use client';

import { Text } from '@lobehub/ui';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { notification } from '@/components/AntdStaticMethods';
import { useUserStore } from '@/store/user';
import { authSelectors, userProfileSelectors } from '@/store/user/selectors';

import ProfileRow from './ProfileRow';

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

  return (
    <ProfileRow
      action={
        <Text
          onClick={sending ? undefined : handleChangePassword}
          style={{
            cursor: sending ? 'default' : 'pointer',
            fontSize: 13,
            opacity: sending ? 0.5 : 1,
          }}
        >
          {hasPasswordAccount ? t('profile.changePassword') : t('profile.setPassword')}
        </Text>
      }
      label={t('profile.password')}
      mobile={mobile}
    >
      <Text>{hasPasswordAccount ? '••••••' : '--'}</Text>
    </ProfileRow>
  );
};

export default PasswordRow;
