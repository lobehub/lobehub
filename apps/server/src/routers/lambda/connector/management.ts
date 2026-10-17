import { upsertPluginMode } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { AgentModel } from '@/database/models/agent';
import {
  ConnectorMcpConnectionType,
  ConnectorSourceType,
  ConnectorStatus,
} from '@/database/schemas';
import { getComposioClient } from '@/libs/composio';
import { withTrustedLinkedByUserId } from '@/server/utils/connectorAttribution';

import { assertWorkspaceRowManageable } from '../_helpers/assertWorkspaceRowManageable';
import { connectorWriteProcedure } from './procedures';

const oidcConfigSchema = z.object({
  authorizationEndpoint: z.string().optional(),
  clientId: z.string().optional(),
  clientSecret: z.string().optional(),
  issuer: z.string().optional(),
  redirectUri: z.string().optional(),
  registrationEndpoint: z.string().optional(),
  scheme: z.enum(['pre_registration', 'dcr', 'client_id_metadata_document']),
  scopes: z.array(z.string()).optional(),
  tokenEndpoint: z.string().optional(),
  usePKCE: z.boolean().optional(),
});

/**
 * Non-OAuth credentials the client may set directly when creating/updating a
 * connector. OAuth2 tokens are intentionally excluded — those are written only
 * by the OAuth callback after a successful authorization exchange.
 */
const connectorCredentialsInputSchema = z.discriminatedUnion('type', [
  z.object({ token: z.string().min(1), type: z.literal('bearer') }),
  z.object({ apiKey: z.string().min(1), type: z.literal('apikey') }),
  z.object({ headers: z.record(z.string(), z.string()), type: z.literal('header') }),
]);

const createConnectorSchema = z.object({
  /**
   * Bind this connector to a specific agent (Agent > Workspace/Personal). When
   * set, the row is agent-scoped: it only resolves for that agent's runs and
   * holds the agent's own credentials (service-account pattern). The caller must
   * be able to edit the agent. Omit for a normal personal/workspace connector.
   */
  agentId: z.string().optional(),
  credentials: connectorCredentialsInputSchema.optional(),
  identifier: z.string().min(1).max(255),
  isEnabled: z.boolean().optional().default(true),
  mcpConnectionType: z
    .enum([
      ConnectorMcpConnectionType.http,
      ConnectorMcpConnectionType.stdio,
      ConnectorMcpConnectionType.cloud,
    ])
    .optional(),
  mcpServerUrl: z.string().url().optional(),
  mcpStdioConfig: z
    .object({
      args: z.array(z.string()).optional(),
      command: z.string(),
      env: z.record(z.string(), z.string()).optional(),
    })
    .optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  name: z.string().min(1).max(255),
  oidcConfig: oidcConfigSchema.optional(),
  sourceType: z.enum([
    ConnectorSourceType.builtin,
    ConnectorSourceType.custom,
    ConnectorSourceType.marketplace,
  ]),
});

export const connectorManagementProcedures = {
  // ── Mutations ─────────────────────────────────────────────────────────────

  create: connectorWriteProcedure.input(createConnectorSchema).mutation(async ({ input, ctx }) => {
    const { agentId } = input;

    // Agent-scoped connector: the caller must be able to edit the target agent
    // before a credential is bound to it — otherwise a user could attach their
    // account to someone else's agent. Scoped to the caller's user/workspace.
    if (agentId) {
      const agentModel = new AgentModel(ctx.serverDB, ctx.userId, ctx.workspaceId ?? undefined);
      const canEdit = await agentModel.existsOwnedById(agentId);
      if (!canEdit) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Agent not found or not editable' });
      }
    }

    const fields = {
      // The model expects the decrypted JSON string and encrypts it at rest.
      credentials: input.credentials ? JSON.stringify(input.credentials) : null,
      mcpConnectionType: input.mcpConnectionType ?? null,
      mcpServerUrl: input.mcpServerUrl ?? null,
      mcpStdioConfig: input.mcpStdioConfig ?? null,
      // Drop any client-supplied `composio.linkedByUserId` — it is server-owned
      // (written by the OAuth connect path), and trusting it here would let a
      // member spoof connector attribution. No existing row on create → the
      // field is simply removed.
      metadata: withTrustedLinkedByUserId(input.metadata, undefined) ?? null,
      name: input.name,
      oidcConfig: input.oidcConfig ?? null,
    };

    // Idempotent on (user_id, identifier): re-adding or re-authorizing the same
    // connector updates the existing row instead of violating the unique index.
    // Status resets to `disconnected` — the OAuth callback / tool sync promotes
    // it back to `connected` on success.
    //
    // `sourceType` is honored on update so the legacy customPlugin → connector
    // migration can promote a half-baked `marketplace` row left behind by the
    // older `syncPluginTools` code path into a proper `custom` row. Without
    // this the connector would land but never appear in custom-connector
    // listings (selector filters on sourceType === 'custom'). Safe because the
    // other callers (`AddConnectorModal`, marketplace bootstrap) always pass
    // the same sourceType they originally created the row with.
    // Idempotent within the EXACT scope (this agent's row, or the base row when
    // no agentId). The exact-scope lookup is critical: creating an agent
    // connector must not update the personal/workspace row of the same
    // identifier, and re-adding the same agent connector updates its own row —
    // enforcing "one connector per identifier per agent" at the app layer (the
    // DB indexes are non-unique so multiple same-identifier rows can coexist
    // across scopes).
    const existing = await ctx.connectorModel.findScopedByIdentifier(input.identifier, agentId);
    if (existing) {
      // The upsert path rewrites another creator's config/credentials — only
      // the creator (or a workspace owner) may re-add over an existing row.
      assertWorkspaceRowManageable(ctx, existing.userId, 'connector');
      await ctx.connectorModel.update(existing.id, {
        ...fields,
        isEnabled: input.isEnabled ?? true,
        sourceType: input.sourceType,
        status: ConnectorStatus.disconnected,
      });
      // `isNew` lets clients tell a fresh row from an updated pre-existing one —
      // client-side caches can't answer this reliably (the connector list may
      // not be fetched yet), and rollback-on-sync-failure must never delete a
      // connector the user already had.
      return { id: existing.id, isNew: false };
    }

    const created = await ctx.connectorModel.create({
      ...fields,
      agentId: agentId ?? null,
      identifier: input.identifier,
      isEnabled: input.isEnabled ?? true,
      sourceType: input.sourceType,
      status: ConnectorStatus.disconnected,
    });
    return { id: created.id, isNew: true };
  }),
  update: connectorWriteProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        patch: createConnectorSchema
          .partial()
          // `agentId` is intentionally omitted: moving a connector in/out of
          // agent scope must go through bindAgent/unbindAgent (agent edit-rights
          // + uniqueness guards), not the generic update patch.
          .omit({ agentId: true, identifier: true, sourceType: true })
          // Allow `null` here so an edit can clear credentials (switch to no-auth).
          .extend({ credentials: connectorCredentialsInputSchema.nullish() }),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const target = await ctx.connectorModel.findById(input.id);
      if (!target) throw new TRPCError({ code: 'NOT_FOUND', message: 'Connector not found' });
      assertWorkspaceRowManageable(ctx, target.userId, 'connector');

      const { credentials, ...patch } = input.patch;
      // Preserve the server-owned `composio.linkedByUserId` from the stored row
      // and ignore whatever the client sent, so an edit can never spoof (or
      // silently clear) the connector's authorizer. Untouched when the patch
      // omits metadata.
      const metadata = withTrustedLinkedByUserId(patch.metadata, target.metadata);
      await ctx.connectorModel.update(input.id, {
        ...patch,
        ...(patch.metadata === undefined ? {} : { metadata }),
        // undefined → leave untouched; null → clear; object → encrypt the JSON string.
        // When credentials are cleared, also drop the cached expiry timestamp so
        // token-refresh logic doesn't act on a stale value for the new server.
        ...(credentials === undefined
          ? {}
          : {
              credentials: credentials ? JSON.stringify(credentials) : null,
              ...(credentials === null ? { tokenExpiresAt: null } : {}),
            }),
      } as any);
    }),
  delete: connectorWriteProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const target = await ctx.connectorModel.findById(input.id);
      // Missing row → keep the delete idempotent, nothing to authorize.
      if (!target) return;
      assertWorkspaceRowManageable(ctx, target.userId, 'connector');

      const connectedAccountId = target.metadata?.composio?.connectedAccountId;
      if (connectedAccountId) {
        try {
          await getComposioClient().connectedAccounts.delete(connectedAccountId);
        } catch (error) {
          // Keep deletion recoverable when the remote account is already gone or
          // Composio is temporarily unavailable. This matches deleteConnection:
          // the local connector must not become impossible to remove.
          console.warn('[Composio] Failed to delete remote connection:', error);
        }

        // Personal Composio connections still carry the legacy plugin projection.
        // Agent-scoped connections never create one, so do not remove a base
        // plugin that may belong to a separate personal connection.
        if (!target.agentId) await ctx.pluginModel.delete(target.identifier);
      }

      await ctx.connectorModel.delete(input.id);

      // Agent-owned connector: also unpin its tool from the owning agent's
      // `plugins`, so deleting it here matches the agent-profile delete (row +
      // pin) and never leaves a dangling pin. Done server-side because the
      // unified settings page has no safe access to an arbitrary agent's config
      // (mirrors the profile page's client-side unpin, `upsertPluginMode(...,
      // 'auto')`). Idempotent: re-running on an already-unpinned agent is a no-op.
      if (target.agentId) {
        const agentModel = new AgentModel(ctx.serverDB, ctx.userId, ctx.workspaceId ?? undefined);
        const config = await agentModel.getAgentConfigById(target.agentId);
        if (config) {
          await agentModel.update(target.agentId, {
            plugins: upsertPluginMode(
              config.plugins ?? undefined,
              target.identifier,
              'auto',
            ) as any,
          });
        }
      }
    }),
};
