'use client';

import type { ReactNode } from 'react';
import { memo } from 'react';
import { useParams } from 'react-router-dom';

import NotFound from '@/components/404';
import BrandTextLoading from '@/components/Loading/BrandTextLoading';

import OAuthGuard from '../OAuthGuard';
import ClientError from './ClientError';
import Consent from './Consent';
import Login from './Login';
import { InteractionDetailsError, useInteractionDetails } from './useInteractionDetails';

const renderError = (error: unknown): ReactNode => {
  if (error instanceof InteractionDetailsError) {
    if (error.status === 404) return <NotFound />;

    if (error.status === 409)
      return (
        <ClientError
          error={{
            messageKey: 'consent.error.unsupportedInteraction.message',
            titleKey: 'consent.error.unsupportedInteraction.title',
            values: { promptName: error.promptName || '' },
          }}
        />
      );

    if (error.status === 400)
      return (
        <ClientError
          error={{
            messageKey: 'consent.error.sessionInvalid.message',
            titleKey: 'consent.error.sessionInvalid.title',
          }}
        />
      );

    return (
      <ClientError
        error={{
          messageKey: 'consent.error.unknown.message',
          titleKey: 'consent.error.title',
        }}
      />
    );
  }

  const message = error instanceof Error ? error.message : undefined;

  return (
    <ClientError
      error={{
        message,
        messageKey: message ? undefined : 'consent.error.unknown.message',
        titleKey: 'consent.error.title',
      }}
    />
  );
};

const InteractionContent = memo(() => {
  const { uid } = useParams<{ uid: string }>();
  const { data, error, isLoading } = useInteractionDetails(uid);

  if (!uid) return <NotFound />;
  if (error) return renderError(error);
  if (isLoading || !data) return <BrandTextLoading debugId={'Auth > OAuthConsent'} />;

  if (data.prompt === 'login') return <Login clientMetadata={data.clientMetadata} uid={data.uid} />;

  return (
    <Consent
      clientId={data.clientId}
      clientMetadata={data.clientMetadata}
      redirectUri={data.redirectUri}
      scopes={data.scopes}
      uid={data.uid}
    />
  );
});

InteractionContent.displayName = 'OAuthInteractionContent';

const OAuthConsent = memo(() => (
  <OAuthGuard>
    <InteractionContent />
  </OAuthGuard>
));

OAuthConsent.displayName = 'OAuthConsent';

export default OAuthConsent;
