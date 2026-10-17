import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import { AgentModel } from '@/database/models/agent';
import { getConnectorRedirectUri } from '@/server/services/connector/oauth';
import {
  resolveConnectorAuthorizerId,
  resolveUserDisplayMap,
} from '@/server/utils/connectorAttribution';

import { assertWorkspaceRowManageable } from '../_helpers/assertWorkspaceRowManageable';
import { connectorProcedure, connectorWriteProcedure } from './procedures';

export const connectorReadProcedures = {
  // ── Queries ──────────────────────────────────────────────────────────────

  list: connectorProcedure.query(async ({ ctx }) => {
    const connectors = await ctx.connectorModel.query();

    // Attribution — resolve the member who authorized each connector (workspace
    // dimension), so the profile can tag "authorized by X". The ids come from
    // scope-checked rows the caller already sees.
    const authorMap = await resolveUserDisplayMap(
      ctx.serverDB,
      connectors.map((c) => resolveConnectorAuthorizerId(c)),
    );

    const toolsByConnector = await Promise.all(
      connectors.map(async (c) => {
        const tools = await ctx.connectorToolModel.queryByConnector(c.id);
        // Never ship decrypted OAuth tokens or the client secret to the browser.
        const { credentials: _credentials, oidcConfig, ...rest } = c;
        const safeOidcConfig = oidcConfig ? { ...oidcConfig, clientSecret: undefined } : oidcConfig;
        const author = authorMap.get(resolveConnectorAuthorizerId(c) ?? '');
        return {
          ...rest,
          authorizedByAvatar: author?.avatar ?? null,
          authorizedByName: author?.name ?? null,
          oidcConfig: safeOidcConfig,
          tools,
        };
      }),
    );

    return toolsByConnector;
  }),
  /**
   * List the connectors bound to a specific agent (agent-scoped rows only). The
   * agent-settings UI uses this to show + manage the agent's own connectors,
   * which the base `list` deliberately excludes.
   */
  listByAgent: connectorProcedure
    .input(z.object({ agentId: z.string() }))
    .query(async ({ input, ctx }) => {
      const connectors = await ctx.connectorModel.queryByAgent(input.agentId);

      // Attribution — the member who authorized each agent-scoped connector, so
      // a teammate viewing the agent sees "authorized by X" on each chip.
      const authorMap = await resolveUserDisplayMap(
        ctx.serverDB,
        connectors.map((c) => resolveConnectorAuthorizerId(c)),
      );

      return Promise.all(
        connectors.map(async (c) => {
          const tools = await ctx.connectorToolModel.queryByConnector(c.id);
          const { credentials: _credentials, oidcConfig, ...rest } = c;
          const safeOidcConfig = oidcConfig
            ? { ...oidcConfig, clientSecret: undefined }
            : oidcConfig;
          const author = authorMap.get(resolveConnectorAuthorizerId(c) ?? '');
          return {
            ...rest,
            authorizedByAvatar: author?.avatar ?? null,
            authorizedByName: author?.name ?? null,
            oidcConfig: safeOidcConfig,
            tools,
          };
        }),
      );
    }),
  /**
   * List every agent-OWNED connector in the current scope (all agents at once),
   * so the unified connector-settings page can show "which connector belongs to
   * which agent" without querying one agent at a time. Each row keeps its
   * `agentId` and is enriched with the owning agent's `agentTitle`/`agentAvatar`
   * for attribution badges. Scope-correct via `ConnectorModel.ownership()` (and
   * `AgentModel.ownership()` for the titles) — a workspace context only returns
   * that workspace's agent connectors ( /).
   */
  listAgentBound: connectorProcedure.query(async ({ ctx }) => {
    const connectors = await ctx.connectorModel.queryAllAgentScoped();

    // Resolve owning-agent display info in one scoped query (workspace-aware),
    // instead of loading each agent's config client-side from a page that isn't
    // in any agent's context.
    const agentIds = [
      ...new Set(connectors.map((c) => c.agentId).filter((id): id is string => !!id)),
    ];
    const agentModel = new AgentModel(ctx.serverDB, ctx.userId, ctx.workspaceId ?? undefined);
    // `getAgentAvatarsByIds` applies `AgentModel.ownership()` (visibility-aware):
    // in a workspace it returns only agents visible to the caller — public ones
    // plus their own private agents. A `user_connectors` row is scoped only by
    // `workspace_id`, so on its own it would surface connectors owned by another
    // member's PRIVATE agent. Gate on the visible-agent set so private-agent
    // connector inventory never leaks across members.
    const agentMetas = agentIds.length > 0 ? await agentModel.getAgentAvatarsByIds(agentIds) : [];
    const agentMetaById = new Map(agentMetas.map((m) => [m.id, m]));

    return Promise.all(
      connectors
        .filter((c) => !!c.agentId && agentMetaById.has(c.agentId))
        .map(async (c) => {
          const tools = await ctx.connectorToolModel.queryByConnector(c.id);
          const { credentials: _credentials, oidcConfig, ...rest } = c;
          const safeOidcConfig = oidcConfig
            ? { ...oidcConfig, clientSecret: undefined }
            : oidcConfig;
          const meta = agentMetaById.get(c.agentId!);
          return {
            ...rest,
            agentAvatar: meta?.avatar ?? null,
            agentName: meta?.name ?? null,
            agentTitle: meta?.title ?? null,
            oidcConfig: safeOidcConfig,
            tools,
          };
        }),
    );
  }),
  /**
   * Return the connector record with decrypted user-set credentials so the
   * edit form can pre-fill accurately. Only the connector owner can call this
   * (enforced by connectorProcedure ownership check).
   *
   * Machine-managed secrets are intentionally excluded:
   * - OAuth access/refresh tokens (type 'oauth2') → stripped, returned as null
   * - oidcConfig.clientSecret (DCR-registered secret)  → stripped
   * User-set credentials (bearer token, custom headers) are returned as-is so
   * the edit form can display them.
   */
  // Member-gated even though it's a query: it returns decrypted credentials
  // for edit prefill, so a creator later downgraded to viewer must not reach it.
  getForEdit: connectorWriteProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      const connector = await ctx.connectorModel.findById(input.id);
      if (!connector) throw new TRPCError({ code: 'NOT_FOUND', message: 'Connector not found' });
      // Edit-read returns decrypted credentials — same creator/owner gate as
      // the mutations that this edit view feeds.
      assertWorkspaceRowManageable(ctx, connector.userId, 'connector');

      const { oidcConfig, credentials, ...rest } = connector;
      const safeOidcConfig = oidcConfig ? { ...oidcConfig, clientSecret: undefined } : oidcConfig;
      // OAuth tokens are machine-managed — don't return them; the UI only needs
      // to know an OAuth flow is configured (reflected via oidcConfig presence).
      const safeCredentials = credentials?.type === 'oauth2' ? null : credentials;

      return { ...rest, credentials: safeCredentials, oidcConfig: safeOidcConfig };
    }),
  /**
   * The exact redirect URI the server will send to the OAuth/DCR endpoints.
   * The Add modal must display THIS value (not a client-derived origin) so the
   * URI the user registers matches the one used at authorize time.
   */
  getRedirectUri: wsCompatProcedure.query(() => ({ redirectUri: getConnectorRedirectUri() })),
};
