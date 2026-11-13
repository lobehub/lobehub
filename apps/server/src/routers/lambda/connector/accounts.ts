import type { ConnectorOIDCConfig } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { loadConnectorLinksMap } from '@/server/services/connector/links';
import {
  buildAuthorizationUrl,
  discoverConnectorOAuth,
  getConnectorRedirectUri,
  resolveConnectorClient,
  resolveConnectorOAuthScopes,
  toClientInformation,
} from '@/server/services/connector/oauth';
import {
  generateConnectorOAuthState,
  readConnectorOAuthCompletion,
  saveConnectorOAuthState,
} from '@/server/services/connector/stateStore';
import { sanitizeReturnTo } from '@/server/services/scm/scope';

import { assertConnectorMaintainable } from '../_helpers/connectorManagePolicy';
import { connectorProcedure, connectorWriteProcedure } from './procedure';

export const connectorAccountProcedures = {
  startOAuth: connectorWriteProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        returnTo: z.string().optional(),
        link: z
          .discriminatedUnion('mode', [
            z.object({ mode: z.literal('add') }),
            z.object({ mode: z.literal('reauthorize'), linkId: z.string() }),
          ])
          .optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const connector = await ctx.connectorModel.findById(input.id);
      if (!connector) throw new TRPCError({ code: 'NOT_FOUND', message: 'Connector not found' });
      // Re-authorizing replaces the stored OAuth credentials with the caller's.
      await assertConnectorMaintainable(ctx, connector);
      if (!connector.mcpServerUrl) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Connector has no MCP server URL' });
      }

      if (
        input.link?.mode === 'add' &&
        (connector.sourceType !== 'custom' || connector.mcpConnectionType !== 'http')
      )
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Multiple accounts require a custom HTTP connector',
        });
      const links = (await loadConnectorLinksMap([connector], ctx)).get(connector.id) ?? [];
      const linkTarget =
        input.link?.mode === 'add'
          ? { kind: 'new' as const }
          : input.link?.mode === 'reauthorize'
            ? { kind: 'existing' as const, linkId: input.link.linkId }
            : links.length
              ? { kind: 'existing' as const, linkId: links[0].id }
              : { kind: 'new' as const };
      if (linkTarget.kind === 'existing' && !links.some((link) => link.id === linkTarget.linkId))
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Connector account not found' });
      const existing: ConnectorOIDCConfig = connector.oidcConfig ?? { scheme: 'dcr' };
      const redirectUri = getConnectorRedirectUri();

      // 1. Discover the authorization server backing the MCP resource.
      // Discovery and registration failures below are server-compatibility
      // problems the user must fix in their OAuth setup, not internal errors —
      // surface them as BAD_REQUEST with the reason so the form can show it.
      const discovery = await discoverConnectorOAuth(connector.mcpServerUrl).catch(
        (error: unknown) => {
          throw new TRPCError({
            cause: error,
            code: 'BAD_REQUEST',
            message: (error as Error)?.message ?? String(error),
          });
        },
      );

      const { authorizationServerUrl, metadata } = discovery;
      const scopes = resolveConnectorOAuthScopes({
        discovery,
        existingScopes: existing.scopes,
        preRegistered: existing.scheme === 'pre_registration',
      });

      // 2. Resolve the OAuth client: pre-registration, CIMD, then DCR.
      const { clientId, clientSecret, scheme, tokenEndpointAuthMethod } =
        await resolveConnectorClient({
          authorizationServerUrl,
          existing,
          metadata,
          redirectUri,
          scopes,
        }).catch((error: unknown) => {
          throw new TRPCError({
            cause: error,
            code: 'BAD_REQUEST',
            message: (error as Error)?.message ?? String(error),
          });
        });

      // 3. Persist the resolved config so the callback + refresh can reuse it.
      const resolvedOidc: ConnectorOIDCConfig = {
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
        prompt:
          linkTarget.kind === 'new' &&
          Array.isArray(
            (metadata as { prompt_values_supported?: string[] }).prompt_values_supported,
          ) &&
          (metadata as { prompt_values_supported?: string[] }).prompt_values_supported!.includes(
            'select_account',
          )
            ? 'select_account'
            : undefined,
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
        linkTarget,
        // Only an in-app path may ever be followed after the callback.
        returnTo: sanitizeReturnTo(input.returnTo),
        workspaceId: ctx.workspaceId ?? undefined,
      });

      return { authorizationUrl, flowId: state };
    }),

  oauthResult: connectorProcedure
    .input(z.object({ flowId: z.string() }))
    .query(async ({ input, ctx }) => {
      const result = await readConnectorOAuthCompletion(input.flowId);
      if (
        !result ||
        result.lobeUserId !== ctx.userId ||
        (result.workspaceId ?? null) !== (ctx.workspaceId ?? null)
      )
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Authorization result not found' });
      return { linkId: result.linkId, outcome: result.outcome };
    }),

  renameLink: connectorWriteProcedure
    .input(z.object({ linkId: z.string(), name: z.string().trim().min(1).max(64) }))
    .mutation(async ({ input, ctx }) => {
      const link = await ctx.connectorLinkModel.findById(input.linkId);
      const connector = link && (await ctx.connectorModel.findById(link.userConnectorId));
      if (!connector)
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Connector account not found' });
      await assertConnectorMaintainable(ctx, connector);
      try {
        await ctx.connectorLinkModel.rename(input.linkId, input.name);
      } catch (error) {
        const cause = error as { code?: string; cause?: { code?: string } };
        if (cause.code === '23505' || cause.cause?.code === '23505')
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'An account with this name already exists',
          });
        throw error;
      }
    }),

  deleteLink: connectorWriteProcedure
    .input(z.object({ linkId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const link = await ctx.connectorLinkModel.findById(input.linkId);
      const connector = link && (await ctx.connectorModel.findById(link.userConnectorId));
      if (!connector)
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Connector account not found' });
      await assertConnectorMaintainable(ctx, connector);
      await ctx.connectorAccountRepo.removeLink(input.linkId);
    }),
};
