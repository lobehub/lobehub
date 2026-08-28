'use client';

import { Flexbox, Icon } from '@lobehub/ui';
import { Button, Text } from '@lobehub/ui/base-ui';
import { cssVar } from 'antd-style';
import { CheckCircle2Icon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useUserStore } from '@/store/user';
import { authSelectors, userProfileSelectors } from '@/store/user/selectors';

import ProfileRow from './ProfileRow';
import { usePasswordReset } from './usePasswordReset';

const PasswordRow = () => {
  const { t } = useTranslation('auth');
  const userProfile = useUserStore(userProfileSelectors.userProfile);
  const hasPasswordAccount = useUserStore(authSelectors.hasPasswordAccount);
  const { requestReset, sending, sent } = usePasswordReset(userProfile?.email);

  return (
    <ProfileRow
      anchor={'profile-password'}
      label={t('profile.password')}
      action={
        <Button loading={sending} size="small" onClick={requestReset}>
          {sent
            ? t('betterAuth.signin.emailSent.resend')
            : hasPasswordAccount
              ? t('profile.changePassword')
              : t('profile.setPassword')}
        </Button>
      }
    >
      {sent && (
        <Flexbox horizontal align={'center'} gap={6}>
          <Icon color={cssVar.colorSuccess} icon={CheckCircle2Icon} size={14} />
          <Text fontSize={12} type={'secondary'}>
            {t('profile.resetPasswordSent', { email: userProfile?.email })}
          </Text>
        </Flexbox>
      )}
    </ProfileRow>
  );
};

export default PasswordRow;
