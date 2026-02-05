'use client';

import { Avatar, Block, Button, Flexbox, Skeleton, Text } from '@lobehub/ui';
import React, { memo } from 'react';
import { useTranslation } from 'react-i18next';

import AuthCard from '@/features/AuthCard';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

import OAuthApplicationLogo from './components/OAuthApplicationLogo';

interface LoginConfirmProps {
  clientMetadata: {
    clientName?: string;
    isFirstParty?: boolean;
    logo?: string;
  };
  uid: string;
}

const LoginConfirmClient = memo<LoginConfirmProps>(({ uid, clientMetadata }) => {
  const { t } = useTranslation('oauth'); // Assuming translations are in 'oauth'

  const clientDisplayName = clientMetadata?.clientName || 'the application';

  const isUserStateInit = useUserStore((s) => s.isUserStateInit);
  const avatar = useUserStore(userProfileSelectors.userAvatar);
  const nickName = useUserStore(userProfileSelectors.nickName);

  const [isLoading, setIsLoading] = React.useState(false);

  const titleText = t('login.title', { clientName: clientDisplayName });
  const descriptionText = t('login.description', { clientName: clientDisplayName });
  const buttonText = t('login.button'); // Or "Continue"

  return (
    <Flexbox gap={16} width={'min(100%,400px)'}>
      <OAuthApplicationLogo
        clientDisplayName={clientDisplayName}
        isFirstParty={clientMetadata.isFirstParty}
        logoUrl={clientMetadata.logo}
      />
      <AuthCard
        subtitle={descriptionText}
        title={titleText}
        footer={
          <form
            action="/oidc/consent"
            method="post"
            style={{ width: '100%' }}
            onSubmit={() => setIsLoading(true)}
          >
            {/* Adjust action URL */}
            <input name="uid" type="hidden" value={uid} />
            <input name="choice" type="hidden" value={'accept'} />
            {/* Single confirmation button */}
            <Button
              block
              disabled={!isUserStateInit}
              htmlType="submit"
              loading={isLoading}
              name="consent"
              size="large"
              type="primary"
              value="accept"
            >
              {buttonText}
            </Button>
          </form>
        }
      >
        <Block padding={16} variant={'outlined'}>
          {isUserStateInit ? (
            <Flexbox horizontal align={'center'} gap={16}>
              <Avatar alt={nickName || ''} avatar={avatar} shape={'square'} size={40} />
              <Text fontSize={18} weight={500}>
                {nickName}
              </Text>
            </Flexbox>
          ) : (
            <Flexbox horizontal gap={16}>
              <Skeleton.Avatar active shape={'square'} size={40} />
              <Skeleton.Button active />
            </Flexbox>
          )}
        </Block>
      </AuthCard>
    </Flexbox>
  );
});

LoginConfirmClient.displayName = 'LoginConfirmClient';

export default LoginConfirmClient;
