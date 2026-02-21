import { useAnalytics } from '@lobehub/analytics/react';
import { Button, Flexbox } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import UserInfo from '../UserInfo';

const UserLoginOrSignup = memo<{ onClick: () => void }>(({ onClick }) => {
  const { t } = useTranslation('auth');
  const { analytics } = useAnalytics();

  const handleClick = () => {
    analytics?.track({
      name: 'login_or_signup_clicked',
      properties: {
        spm: 'homepage.login_or_signup.click',
      },
    });

    onClick();
  };

  return (
    <>
      <UserInfo />
      <Flexbox paddingBlock={12} paddingInline={16} width={'100%'}>
        <Button block type={'primary'} onClick={handleClick}>
          {t('loginOrSignup')}
        </Button>
      </Flexbox>
    </>
  );
});

export default UserLoginOrSignup;
