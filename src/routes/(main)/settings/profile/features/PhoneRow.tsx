'use client';

import { Flexbox, Text } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import { buildTrialPhoneVerifyUrl } from '@/libs/better-auth/phone';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

import ProfileRow from './ProfileRow';

const PhoneRow = () => {
  const { t } = useTranslation('auth');
  const navigate = useNavigate();
  const user = useUserStore(userProfileSelectors.userProfile);
  const phone = user?.phoneNumber;
  const verified = Boolean(user?.phoneNumberVerified);

  const handleVerify = () => {
    navigate(buildTrialPhoneVerifyUrl('/settings/profile'));
  };

  return (
    <ProfileRow
      anchor="profile-phone"
      label={t('profile.phone')}
      action={
        !verified ? (
          <Button size="small" type="primary" onClick={handleVerify}>
            {t('profile.verifyPhoneForTrial')}
          </Button>
        ) : undefined
      }
    >
      <Flexbox gap={4}>
        <Text>{phone || t('profile.phoneEmpty')}</Text>
        <Text fontSize={12} type="secondary">
          {verified ? t('profile.phoneVerified') : t('profile.phoneUnverifiedHint')}
        </Text>
      </Flexbox>
    </ProfileRow>
  );
};

export default PhoneRow;
