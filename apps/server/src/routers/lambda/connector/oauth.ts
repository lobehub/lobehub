import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import type { OIDCConfig } from '@/database/schemas';
import {
  buildAuthorizationUrl,
  discoverConnectorOAuth,
  getConnectorRedirectUri,
  registerDynamicClient,
  registeredAuthMethod,
  toClientInformation,
} from '@/server/services/connector/oauth';
import {
  generateConnectorOAuthState,
  saveConnectorOAuthState,
} from '@/server/services/connector/stateStore';

import { assertWorkspaceRowManageable } from '../_helpers/assertWorkspaceRowManageable';
import { connectorWriteProcedure } from './procedures';

export const oauthProcedures = {
  /**
   * Begin the OAuth authorization-code flow for a custom MCP connector.
   *
   * Discovers the authorization server (RFC 9728 → RFC 8414), resolves the
   * client (pre-registration when a client_id was provided, otherwise RFC 7591
   * dynamic registration), persists the resolved OIDC config, and returns the
   * authorize URL for the client to open. The PKCE verifier is stashed in Redis
   * keyed by `state`; the callback route completes the exchange.
   */
  startOAuth: connectorWriteProcedure
    .input(z.object({ id: z.string().uuid(), returnTo: z.string().optional() }))
    .mutation(async ({ input, ctx }) => {
      const connector = await ctx.connectorModel.findById(input.id);
      if (!connector) throw new TRPCError({ code: 'NOT_FOUND', message: 'Connector not found' });
      // Re-authorizing overwrites the stored OAuth credentials.
      assertWorkspaceRowManageable(ctx, connector.userId, 'connector');
      if (!connector.mcpServerUrl) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Connector has no MCP server URL' });
      }

      const existing: OIDCConfig = connector.oidcConfig ?? { scheme: 'dcr' };
      const redirectUri = getConnectorRedirectUri();

      // 1. Discover the authorization server backing the MCP resource.
      // Discovery and registration failures below are server-compatibility
      // problems the user must fix in their OAuth setup, not internal errors —
      // surface them as BAD_REQUEST with the reason so the form can show it.
      const { authorizationServerUrl, metadata } = await discoverConnectorOAuth(
        connector.mcpServerUrl,
      ).catch((error: unknown) => {
        throw new TRPCError({
          cause: error,
          code: 'BAD_REQUEST',
          message: (error as Error)?.message ?? String(error),
        });
      });

      // Default to the scopes advertised by the server when the user did not
      // specify any — many MCP authorization servers reject (or issue a useless
      // token for) a scope-less request.
      const scopes =
        existing.scopes && existing.scopes.length > 0 ? existing.scopes : metadata.scopes_supported;

      // 2. Resolve the OAuth client: pre-registration vs. DCR.
      let clientId = existing.clientId;
      let clientSecret = existing.clientSecret;
      let tokenEndpointAuthMethod = existing.tokenEndpointAuthMethod;
      const scheme: OIDCConfig['scheme'] = clientId ? 'pre_registration' : 'dcr';

      if (!clientId) {
        if (!metadata.registration_endpoint) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message:
              'This server does not support dynamic registration. Provide an OAuth Client ID in Advanced settings.',
          });
        }
        const reg = await registerDynamicClient({
          authorizationServerUrl,
          metadata,
          redirectUri,
          scopes,
        }).catch((error: unknown) => {
          throw new TRPCError({
            cause: error,
            code: 'BAD_REQUEST',
            message: `Dynamic client registration failed: ${(error as Error)?.message ?? String(error)}`,
          });
        });
        clientId = reg.client_id;
        clientSecret = reg.client_secret ?? undefined;
        tokenEndpointAuthMethod = registeredAuthMethod(reg, metadata);
      }

      // 3. Persist the resolved config so the callback + refresh can reuse it.
      const resolvedOidc: OIDCConfig = {
        ...existing,
        authorizationEndpoint: metadata.authorization_endpoint,
        clientId,
        clientSecret,
        issuer: authorizationServerUrl,
        redirectUri,
        registrationEndpoint: metadata.registration_endpoint,
        scheme,
        scopes,
        tokenEndpoint: metadata.token_endpoint,
        tokenEndpointAuthMethod,
      };
      await ctx.connectorModel.update(input.id, { oidcConfig: resolvedOidc });

      // 4. Build the authorize URL (with PKCE) and stash the verifier under `state`.
      const state = generateConnectorOAuthState();
      const { authorizationUrl, codeVerifier } = await buildAuthorizationUrl({
        authorizationServerUrl,
        clientInformation: toClientInformation(resolvedOidc),
        metadata,
        redirectUri,
        resource: connector.mcpServerUrl,
        scopes,
        state,
      });

      await saveConnectorOAuthState(state, {
        authorizationServerUrl,
        codeVerifier,
        connectorId: input.id,
        lobeUserId: ctx.userId,
        returnTo: input.returnTo,
        workspaceId: ctx.workspaceId ?? undefined,
      });

      return { authorizationUrl };
    }),
};
