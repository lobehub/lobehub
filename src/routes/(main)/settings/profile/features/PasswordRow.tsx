'use client';

import { Alert, Flexbox, Text } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import InlineActionError from '@/components/InlineActionError';
import { useUserStore } from '@/store/user';
import { authSelectors, userProfileSelectors } from '@/store/user/selectors';

import ProfileRow from './ProfileRow';

const PasswordRow = () => {
  const { t } = useTranslation('auth');
  const userProfile = useUserStore(userProfileSelectors.userProfile);
  const hasPasswordAccount = useUserStore(authSelectors.hasPasswordAccount);
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState<'error' | 'idle' | 'sent'>('idle');

  const handleChangePassword = useCallback(async () => {
    if (!userProfile?.email) return;

    try {
      setSending(true);
      setStatus('idle');
      const { requestPasswordReset } = await import('@/libs/better-auth/auth-client');
      await requestPasswordReset({
        email: userProfile.email,
        redirectTo: `/reset-password?email=${encodeURIComponent(userProfile.email)}`,
      });
      setStatus('sent');
    } catch (error) {
      console.error('Failed to send reset password email:', error);
      setStatus('error');
    } finally {
      setSending(false);
    }
  }, [userProfile?.email]);

  return (
    <ProfileRow
      anchor={'profile-password'}
      label={t('profile.password')}
      action={
        <Button loading={sending} size="small" onClick={handleChangePassword}>
          {status === 'sent'
            ? t('betterAuth.signin.emailSent.resend')
            : hasPasswordAccount
              ? t('profile.changePassword')
              : t('profile.setPassword')}
        </Button>
      }
    >
      <Flexbox flex={1} gap={8}>
        {status === 'sent' && (
          <Alert
            title={t('profile.resetPasswordSent')}
            type="success"
            variant="filled"
            description={
              <Text fontSize={12} type="secondary">
                {userProfile?.email}
              </Text>
            }
          />
        )}
        {status === 'error' && (
          <InlineActionError
            retrying={sending}
            title={t('profile.resetPasswordError')}
            onRetry={handleChangePassword}
          />
        )}
      </Flexbox>
    </ProfileRow>
  );
};

export default PasswordRow;
