import { discoverAuthorizationServerMetadata } from '@modelcontextprotocol/sdk/client/auth.js';
import debug from 'debug';
import { type NextRequest, NextResponse } from 'next/server';

import { ConnectorModel } from '@/database/models/connector';
import { ConnectorStatus } from '@/database/schemas';
import { serverDB } from '@/database/server';
import { appEnv } from '@/envs/app';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import { exchangeConnectorCode } from '@/server/services/connector/oauth';
import { consumeConnectorOAuthState } from '@/server/services/connector/stateStore';
import { tokensToCredentials } from '@/server/services/connector/tokens';

const log = debug('lobe-server:connector:oauth-callback');

/** Origin allowed to receive the postMessage result (the app itself). */
const targetOrigin = (): string => {
  try {
    return appEnv.APP_URL ? new URL(appEnv.APP_URL).origin : '*';
  } catch {
    return '*';
  }
};

/** Auto-closing popup page that reports the result back to the opener window. */
const renderResultPage = (result: {
  connectorId?: string;
  error?: string;
  success: boolean;
}): NextResponse => {
  const payload = JSON.stringify({ type: 'lobe-connector-oauth', ...result });
  const html = `<!doctype html>
<html>
  <head><meta charset="utf-8" /><title>Connector authorization</title></head>
  <body style="font-family: system-ui, sans-serif; padding: 24px; text-align: center;">
    <p>${result.success ? 'Authorization complete. You can close this window.' : 'Authorization failed.'}</p>
    <script>
      (function () {
        try {
          if (window.opener) {
            window.opener.postMessage(${payload}, ${JSON.stringify(targetOrigin())});
          }
        } catch (e) {}
        setTimeout(function () { window.close(); }, 300);
      })();
    </script>
  </body>
</html>`;
  return new NextResponse(html, {
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
};

export const GET = async (req: NextRequest) => {
  const searchParams = req.nextUrl.searchParams;
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const oauthError = searchParams.get('error');

  if (oauthError) {
    log('authorization server returned error: %s', oauthError);
    return renderResultPage({ error: oauthError, success: false });
  }

  if (!code || !state) {
    return renderResultPage({ error: 'missing_code_or_state', success: false });
  }

  try {
    const payload = await consumeConnectorOAuthState(state);
    if (!payload) {
      return renderResultPage({ error: 'invalid_or_expired_state', success: false });
    }

    const gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey();
    const connectorModel = new ConnectorModel(serverDB, payload.lobeUserId, gateKeeper);

    const connector = await connectorModel.findById(payload.connectorId);
    if (!connector) {
      return renderResultPage({ error: 'connector_not_found', success: false });
    }

    const oidc = connector.oidcConfig;
    if (!oidc?.clientId) {
      return renderResultPage({ error: 'connector_missing_client', success: false });
    }

    const metadata = await discoverAuthorizationServerMetadata(payload.authorizationServerUrl);
    if (!metadata) {
      return renderResultPage({ error: 'metadata_discovery_failed', success: false });
    }

    const tokens = await exchangeConnectorCode({
      authorizationCode: code,
      authorizationServerUrl: payload.authorizationServerUrl,
      clientInformation: { client_id: oidc.clientId, client_secret: oidc.clientSecret },
      codeVerifier: payload.codeVerifier,
      metadata,
      redirectUri: oidc.redirectUri!,
      resource: connector.mcpServerUrl ?? undefined,
    });

    const { credentials, tokenExpiresAt } = tokensToCredentials(tokens, {
      clientSecret: oidc.clientSecret,
    });

    await connectorModel.update(payload.connectorId, {
      credentials: JSON.stringify(credentials),
      status: ConnectorStatus.connected,
      tokenExpiresAt,
    });

    log('connector %s authorized for user %s', payload.connectorId, payload.lobeUserId);
    return renderResultPage({ connectorId: payload.connectorId, success: true });
  } catch (err) {
    log('connector OAuth callback error: %O', err);
    const message = err instanceof Error ? err.message : 'internal_error';
    return renderResultPage({ error: message, success: false });
  }
};
