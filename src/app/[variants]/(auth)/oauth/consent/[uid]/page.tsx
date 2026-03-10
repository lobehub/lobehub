import { notFound } from 'next/navigation';

import { authEnv } from '@/envs/auth';
import { defaultClients } from '@/libs/oidc-provider/config';
import { OIDCService } from '@/server/services/oidc';

import ConsentClientError from './ClientError';
import Consent from './Consent';
import Login from './Login';

const InteractionPage = async (props: { params: Promise<{ uid: string }> }) => {
  if (!authEnv.ENABLE_OIDC) return notFound();

  const params = await props.params;
  const uid = params.uid;

  try {
    const oidcService = await OIDCService.initialize();

    // Get interaction details, passing request and response objects
    const details = await oidcService.getInteractionDetails(uid);

    // Support login and consent type interactions
    if (details.prompt.name !== 'consent' && details.prompt.name !== 'login') {
      return (
        <ConsentClientError
          error={{
            messageKey: 'consent.error.unsupportedInteraction.message',
            titleKey: 'consent.error.unsupportedInteraction.title',
            values: { promptName: details.prompt.name },
          }}
        />
      );
    }

    // Get client ID and authorization scopes
    const clientId = (details.params.client_id as string) || 'unknown';
    const scopes = (details.params.scope as string)?.split(' ') || [];

    const clientDetail = await oidcService.getClientMetadata(clientId);

    const clientMetadata = {
      clientName: clientDetail?.client_name,
      isFirstParty: defaultClients.map((c) => c.client_id).includes(clientId),
      logo: clientDetail?.logo_uri,
    };
    // Render client component regardless of login or consent type
    if (details.prompt.name === 'login')
      return <Login clientMetadata={clientMetadata} uid={params.uid} />;

    return (
      <Consent
        clientId={clientId}
        clientMetadata={clientMetadata}
        redirectUri={details.params.redirect_uri as string}
        scopes={scopes}
        uid={params.uid}
      />
    );
  } catch (error) {
    console.error('Error handling OIDC interaction:', error);
    // Ensure error handling can display correctly
    const errorMessage = error instanceof Error ? error.message : undefined;
    // Check if it is an 'interaction session not found' error for a more user-friendly message
    if (errorMessage?.includes('interaction session not found')) {
      return (
        <ConsentClientError
          error={{
            messageKey: 'consent.error.sessionInvalid.message',
            titleKey: 'consent.error.sessionInvalid.title',
          }}
        />
      );
    }

    return (
      <ConsentClientError
        error={{
          message: errorMessage,
          messageKey: errorMessage ? undefined : 'consent.error.unknown.message',
          titleKey: 'consent.error.title',
        }}
      />
    );
  }
};

export default InteractionPage;
