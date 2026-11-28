import { hasCallableMcpEndpoint } from '@lobechat/const';
import type { ConnectorVisibility } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { withoutEvalConnectorMarker } from '@/database/models/connectorEval';
import { ConnectorSourceType, ConnectorStatus } from '@/database/schemas';
import { router } from '@/libs/trpc/lambda';
import { withServerOwnedMetadata } from '@/server/utils/connectorAttribution';

import { assertWorkspaceRowManageable } from '../_helpers/assertWorkspaceRowManageable';
import { assertConnectorDeviceBindingAllowed } from '../_helpers/connectorDeviceBinding';
import {
  assertConnectorCredentialsManageable,
  assertConnectorMaintainable,
} from '../_helpers/connectorManagePolicy';
import { buildConnectorMigrationRow } from './legacyMigration';
import { connectorWriteProcedure } from './procedures';

const migrationConnectionOverridesSchema = z.object({
  args: z.array(z.string()).optional(),
  auth: z
    .object({
      accessToken: z.string().optional(),
      clientId: z.string().optional(),
      clientSecret: z.string().optional(),
      token: z.string().optional(),
      type: z.enum(['none', 'bearer', 'oauth2']),
    })
    .optional(),
  boundDeviceId: z.string().optional(),
  command: z.string().optional(),
  connectVia: z.enum(['auto', 'device']).optional(),
  env: z.record(z.string(), z.string()).optional(),
  headers: z.record(z.string(), z.string()).optional(),
  type: z.enum(['http', 'stdio']),
  url: z.string().optional(),
});

/** Legacy MCP plugin promotion and cleanup. */
export const legacyMigrationRouter = router({
  /**
   * Copy a legacy MCP plugin row into a connector without sending its stored
   * credentials through the client. The legacy row is deleted only after the
   * replacement connector has synchronized its tools.
   */
  migrateLegacyPlugin: connectorWriteProcedure
    .input(
      z.object({
        identifier: z.string().min(1).max(255),
        overrides: migrationConnectionOverridesSchema.optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      // Members can install the same legacy plugin with different settings and
      // credentials. Migration must copy the caller's own row, never whichever
      // workspace row a lookup by identifier happens to return first.
      const plugin = await ctx.pluginModel.findOwnedById(input.identifier);
      if (!plugin && (await ctx.pluginModel.findById(input.identifier))) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Only the member who installed this legacy plugin can migrate it',
        });
      }
      if (!plugin) throw new TRPCError({ code: 'NOT_FOUND', message: 'Plugin not found' });
      assertWorkspaceRowManageable(ctx, plugin.userId, 'plugin');

      // A repair retry sends the whole connection form. It is authoritative
      // for the connection fields only: settings, manifest and marketplace
      // provenance still come from the server-confirmed legacy row.
      const migrationSource = input.overrides
        ? {
            ...plugin,
            customParams: { ...plugin.customParams, mcp: input.overrides },
          }
        : plugin;
      const migration = buildConnectorMigrationRow(migrationSource, {
        preferConnectionValues: !!input.overrides,
      });
      if (!migration.ok) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message:
            migration.reason === 'no-mcp'
              ? 'This legacy plugin has no MCP connection to migrate'
              : 'This legacy MCP plugin has no usable server endpoint',
        });
      }

      const visibility = 'public' as const;
      const row = {
        credentials: null,
        mcpStdioConfig: null,
        oidcConfig: null,
        ...migration.payload,
        metadata:
          withoutEvalConnectorMarker(
            withServerOwnedMetadata(migration.payload.metadata, undefined),
          ) ?? null,
      };
      const assertWritable = async (existing?: {
        agentId: string | null;
        metadata?: Record<string, unknown> | null;
        userId: string;
        visibility: ConnectorVisibility;
      }) => {
        if (existing && existing.userId !== ctx.userId)
          await assertConnectorCredentialsManageable(ctx, existing);
        else await assertConnectorMaintainable(ctx, { userId: existing?.userId, visibility });
        await assertConnectorDeviceBindingAllowed(ctx, {
          connector: {
            userId: existing?.userId ?? ctx.userId,
            visibility: existing?.visibility ?? visibility,
          },
          metadata: migration.payload.metadata,
          previous: existing
            ? { metadata: existing.metadata, visibility: existing.visibility }
            : undefined,
        });
      };
      const reAdd = async (existing: {
        agentId: string | null;
        credentials?: unknown;
        id: string;
        mcpConnectionType?: string | null;
        mcpServerUrl?: string | null;
        metadata?: Record<string, unknown> | null;
        sourceType?: string | null;
        userId: string;
        visibility: ConnectorVisibility;
      }) => {
        // A user's existing connector is never overwritten by a legacy-row
        // migration. Two rows are safe to adopt: the marker this endpoint
        // writes (a retry after a failed rollback), and the endpoint-less
        // marketplace projection `syncPluginTools` created for this same legacy
        // row before migration existed. The projection has no credentials or
        // OAuth accounts; one that does is a real connector and still conflicts.
        const endpointlessMarketplaceRow =
          existing.sourceType === ConnectorSourceType.marketplace &&
          !hasCallableMcpEndpoint(existing);
        const hasStoredCredentials =
          endpointlessMarketplaceRow &&
          (!!existing.credentials ||
            (await ctx.connectorLinkModel.listByConnectorIds([existing.id])).length > 0);
        const isLegacyProjection = endpointlessMarketplaceRow && !hasStoredCredentials;
        if (existing.metadata?.migratedFromLegacyPlugin !== true && !isLegacyProjection) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'A connector with this identifier already exists',
          });
        }
        await assertWritable(existing);
        const metadata =
          withServerOwnedMetadata(row.metadata ?? {}, existing.metadata) ?? row.metadata;
        const updated = await ctx.connectorModel.update(existing.id, {
          ...row,
          metadata: metadata && Object.keys(metadata).length > 0 ? metadata : null,
        });
        return updated ? { id: existing.id, isNew: false } : undefined;
      };
      const add = async () => {
        const existing = await ctx.connectorModel.findScopedByIdentifier(
          input.identifier,
          undefined,
          undefined,
          visibility,
        );
        if (existing) return reAdd(existing);
        await assertWritable();
        const claim = await ctx.connectorModel.createUnlessIdentifierHeld({
          ...row,
          visibility,
        });
        if ('holder' in claim) return reAdd(claim.holder);
        return { id: claim.created.id, isNew: true };
      };

      const added = await add();
      if (added) return added;
      const retried = await add();
      if (retried) return retried;
      throw new TRPCError({ code: 'CONFLICT', message: 'Connector changed, try again' });
    }),

  /**
   * Finish a client-synchronized legacy migration by removing only the caller's
   * own legacy row. `plugin.removePlugin` is workspace-wide for a shared
   * identifier; using it here would delete teammates' installations whose
   * settings and credentials were never copied.
   */
  completeLegacyPluginMigration: connectorWriteProcedure
    .input(z.object({ identifier: z.string().min(1).max(255) }))
    .mutation(async ({ input, ctx }) => {
      const [shared, privateRow] = await Promise.all([
        ctx.connectorModel.findScopedByIdentifier(input.identifier, undefined, undefined, 'public'),
        ctx.connectorModel.findScopedByIdentifier(
          input.identifier,
          undefined,
          undefined,
          'private',
        ),
      ]);
      const replacement = [shared, privateRow].find(
        (connector) =>
          connector &&
          connector.status === ConnectorStatus.connected &&
          hasCallableMcpEndpoint(connector) &&
          (connector.metadata?.migratedFromLegacyPlugin === true ||
            connector.metadata?.migratedFromCustomPlugin === true),
      );
      if (!replacement) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'The replacement connector has not synchronized its tools yet',
        });
      }

      const plugin = await ctx.pluginModel.findOwnedById(input.identifier);
      // Already removed: completion is idempotent. Never fall back to the
      // workspace-wide row lookup here, or a retry could remove a teammate's row.
      if (!plugin) return { removed: false };
      assertWorkspaceRowManageable(ctx, plugin.userId, 'plugin');
      await ctx.pluginModel.deleteOwned(input.identifier);
      return { removed: true };
    }),
});
