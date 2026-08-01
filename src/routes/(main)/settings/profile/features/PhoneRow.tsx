'use client';

import { Flexbox, Text } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { useTranslation } from 'react-i18next';

import { buildTrialPhoneVerifyUrl } from '@/libs/better-auth/phone';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

import ProfileRow from './ProfileRow';

const PhoneRow = () => {
  const { t } = useTranslation('auth');
  const user = useUserStore(userProfileSelectors.userProfile);
  const phone = user?.phoneNumber;
  const verified = Boolean(user?.phoneNumberVerified);

  const handleVerify = () => {
    // Hard navigation: `/verify-phone` lives on the auth SPA (`spa-auth`), not the
    // main app router. Client-side `navigate()` stays in the main SPA and hits the
    // catch-all ("Entered Unknown Territory?").
    window.location.assign(buildTrialPhoneVerifyUrl('/settings/profile'));
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
