import { discoverAuthorizationServerMetadata } from '@modelcontextprotocol/sdk/client/auth.js';
import debug from 'debug';
import { type NextRequest, NextResponse } from 'next/server';

import { ConnectorModel } from '@/database/models/connector';
import { ConnectorToolModel } from '@/database/models/connectorTool';
import { serverDB } from '@/database/server';
import { appEnv } from '@/envs/app';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import { exchangeConnectorCode, toClientInformation } from '@/server/services/connector/oauth';
import { consumeConnectorOAuthState } from '@/server/services/connector/stateStore';
import { syncConnectorToolsById } from '@/server/services/connector/sync';
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

/**
 * Serialize a value for safe embedding inside an inline `<script>`. Plain
 * JSON.stringify does NOT escape `</script>` or the U+2028/U+2029 line
 * separators, so an attacker-controlled OAuth error string could break out of
 * the script context and execute on the app origin. Escaping `<`, `>`, `&` and
 * the JS line separators to their `\uXXXX` form closes that hole.
 */
const jsonForScript = (value: unknown): string =>
  JSON.stringify(value).replaceAll(
    /[<>&\u2028\u2029]/g,
    (c) => '\\u' + c.codePointAt(0)!.toString(16).padStart(4, '0'),
  );

const escapeHtml = (value: string): string =>
  value.replaceAll(
    /[&<>"']/g,
    (c) => ({ '"': '&quot;', '&': '&amp;', "'": '&#39;', '<': '&lt;', '>': '&gt;' })[c]!,
  );

/**
 * Popup page that reports the result back to the opener window. Success closes
 * itself; failure stays open with the reason, because providers whose COOP
 * policy severs `window.opener` leave the page as the only place to see it.
 */
const renderResultPage = (result: {
  connectorId?: string;
  error?: string;
  success: boolean;
  /** Whether the tool list synced. `false` = authorized but tools unavailable. */
  synced?: boolean;
}): NextResponse => {
  const payload = jsonForScript({ type: 'lobe-connector-oauth', ...result });
  const html = `<!doctype html>
<html>
  <head><meta charset="utf-8" /><title>Connector authorization</title></head>
  <body style="font-family: system-ui, sans-serif; padding: 24px; text-align: center;">
    <p>${result.success ? 'Authorization complete. You can close this window.' : 'Authorization failed.'}</p>
    ${result.error ? `<p style="color: #888; font-size: 13px; word-break: break-word;">${escapeHtml(result.error)}</p>` : ''}
    <script>
      (function () {
        try {
          // The isolated desktop preload relays status to the native window
          // owner even when a provider's COOP policy severs window.opener.
          window.postMessage(${payload}, window.location.origin);
          if (window.opener) {
            window.opener.postMessage(${payload}, ${jsonForScript(targetOrigin())});
          }
        } catch (e) {}
        ${result.success ? 'setTimeout(function () { window.close(); }, 300);' : ''}
      })();
    </script>
  </body>
</html>`;
  return new NextResponse(html, {
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
};

const renderFailure = (error: string, cause?: unknown): NextResponse => {
  console.error('[connector OAuth callback] failed: %s', error, cause ?? '');
  return renderResultPage({ error, success: false });
};

export const GET = async (req: NextRequest) => {
  const searchParams = req.nextUrl.searchParams;
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const oauthError = searchParams.get('error');

  if (oauthError) {
    const description = searchParams.get('error_description');
    return renderFailure(description ? `${oauthError}: ${description}` : oauthError);
  }

  if (!code || !state) {
    return renderFailure('missing_code_or_state');
  }

  try {
    const payload = await consumeConnectorOAuthState(state);
    if (!payload) {
      return renderFailure('invalid_or_expired_state');
    }

    const gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey();
    // Same scope the connector was created in; otherwise a workspace connector
    // is looked up as a personal one and never found.
    const connectorModel = new ConnectorModel(
      serverDB,
      payload.lobeUserId,
      payload.workspaceId,
      gateKeeper,
    );

    const connector = await connectorModel.findById(payload.connectorId);
    if (!connector) {
      return renderFailure('connector_not_found');
    }

    const oidc = connector.oidcConfig;
    if (!oidc?.clientId) {
      return renderFailure('connector_missing_client');
    }

    const metadata = await discoverAuthorizationServerMetadata(payload.authorizationServerUrl);
    if (!metadata) {
      return renderFailure('metadata_discovery_failed');
    }

    const { authMethod, tokens } = await exchangeConnectorCode({
      authorizationCode: code,
      authorizationServerUrl: payload.authorizationServerUrl,
      clientInformation: toClientInformation(oidc),
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
      // Remember the auth method that worked so refreshes don't fail the same way.
      ...(authMethod && { oidcConfig: { ...oidc, tokenEndpointAuthMethod: authMethod } }),
      tokenExpiresAt,
    });

    // Sync the tool list server-side so the connector is immediately usable —
    // no dependency on the popup/postMessage round-trip. This also sets the
    // connector status (connected on success, error on failure).
    const connectorToolModel = new ConnectorToolModel(
      serverDB,
      payload.lobeUserId,
      payload.workspaceId,
    );
    let synced = false;
    try {
      const { toolCount } = await syncConnectorToolsById(payload.connectorId, {
        connectorModel,
        connectorToolModel,
      });
      synced = true;
      log('connector %s authorized + synced %d tools', payload.connectorId, toolCount);
    } catch (err) {
      // Auth succeeded but the tool list could not be fetched; the user can
      // retry via the Sync button. Report success (auth is valid) but flag the
      // missing sync so the UI doesn't claim a fully-working connector.
      log('post-OAuth tool sync failed for connector=%s: %O', payload.connectorId, err);
    }

    return renderResultPage({ connectorId: payload.connectorId, success: true, synced });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'internal_error';
    return renderFailure(message, err);
  }
};
