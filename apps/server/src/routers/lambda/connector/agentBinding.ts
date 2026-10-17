import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { AgentModel } from '@/database/models/agent';

import { assertWorkspaceRowManageable } from '../_helpers/assertWorkspaceRowManageable';
import { connectorWriteProcedure } from './procedures';

export const agentBindingProcedures = {
  /**
   * Bind an existing connector to an agent (transfer it into the agent scope).
   * The connector then resolves only for that agent's runs and shadows the
   * user's base connector of the same identifier (Agent > Workspace/Personal).
   *
   * Guards: the caller must be able to edit the agent; the agent must not
   * already have a connector for this identifier (one per identifier per agent).
   */
  bindAgent: connectorWriteProcedure
    .input(z.object({ agentId: z.string(), connectorId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const agentModel = new AgentModel(ctx.serverDB, ctx.userId, ctx.workspaceId ?? undefined);
      if (!(await agentModel.existsOwnedById(input.agentId))) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Agent not found or not editable' });
      }

      const connector = await ctx.connectorModel.findById(input.connectorId);
      if (!connector) throw new TRPCError({ code: 'NOT_FOUND', message: 'Connector not found' });
      // Rebinding routes the connector's credentials to the agent — creator/owner only.
      assertWorkspaceRowManageable(ctx, connector.userId, 'connector');

      const existingAgentRow = await ctx.connectorModel.findScopedByIdentifier(
        connector.identifier,
        input.agentId,
      );
      if (existingAgentRow && existingAgentRow.id !== connector.id) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: `Agent already has a "${connector.identifier}" connector`,
        });
      }

      await ctx.connectorModel.update(input.connectorId, { agentId: input.agentId });
      return { id: input.connectorId };
    }),
  /**
   * Unbind a connector from its agent, returning it to the personal/workspace
   * scope. Rejected when a base connector of the same identifier already exists,
   * to keep the base scope single-per-identifier — the caller should delete the
   * agent connector instead of demoting it into a collision.
   */
  unbindAgent: connectorWriteProcedure
    .input(z.object({ connectorId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const connector = await ctx.connectorModel.findById(input.connectorId);
      if (!connector) throw new TRPCError({ code: 'NOT_FOUND', message: 'Connector not found' });
      assertWorkspaceRowManageable(ctx, connector.userId, 'connector');
      if (!connector.agentId) return { id: input.connectorId }; // already base — no-op

      const existingBase = await ctx.connectorModel.findScopedByIdentifier(connector.identifier);
      if (existingBase) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: `A personal "${connector.identifier}" connector already exists; delete the agent connector instead`,
        });
      }

      await ctx.connectorModel.update(input.connectorId, { agentId: null });
      return { id: input.connectorId };
    }),
  /**
   * "Copy user tool": clone a user connector into an independent agent-owned
   * row (own credentials, separately editable). Server-side because the
   * credentials ciphertext never reaches the client (see ConnectorModel).
   */
  copyToAgent: connectorWriteProcedure
    .input(z.object({ agentId: z.string(), connectorId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const agentModel = new AgentModel(ctx.serverDB, ctx.userId, ctx.workspaceId ?? undefined);
      if (!(await agentModel.existsOwnedById(input.agentId))) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Agent not found or not editable' });
      }

      const source = await ctx.connectorModel.findById(input.connectorId);
      if (!source) throw new TRPCError({ code: 'NOT_FOUND', message: 'Connector not found' });
      // Cloning duplicates the source's encrypted credentials into a row the
      // agent owner controls — creator/owner only.
      assertWorkspaceRowManageable(ctx, source.userId, 'connector');

      const existing = await ctx.connectorModel.findScopedByIdentifier(
        source.identifier,
        input.agentId,
      );
      if (existing) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: `Agent already has a "${source.identifier}" connector`,
        });
      }

      const created = await ctx.connectorModel.copyToAgent(input.connectorId, input.agentId);
      if (!created) throw new TRPCError({ code: 'NOT_FOUND', message: 'Connector not found' });
      return { id: created.id };
    }),
  /**
   * "Mount user tool" (Linked): reference-lock a user connector onto this agent.
   * The row stays user-owned (keeps syncing with the user's edits) but resolves
   * for this agent and is locked so no other agent can mount the same one.
   */
  mountToAgent: connectorWriteProcedure
    .input(z.object({ agentId: z.string(), connectorId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const agentModel = new AgentModel(ctx.serverDB, ctx.userId, ctx.workspaceId ?? undefined);
      if (!(await agentModel.existsOwnedById(input.agentId))) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Agent not found or not editable' });
      }

      const connector = await ctx.connectorModel.findById(input.connectorId);
      if (!connector) throw new TRPCError({ code: 'NOT_FOUND', message: 'Connector not found' });
      // Mounting routes the source's credentials to the agent and locks the
      // row (metadata.mountedByAgentId) — creator/owner only.
      assertWorkspaceRowManageable(ctx, connector.userId, 'connector');
      if (connector.agentId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Only a user connector can be mounted (this one is already agent-owned)',
        });
      }

      const lockedBy = connector.metadata?.mountedByAgentId;
      if (lockedBy && lockedBy !== input.agentId) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'Connector is already mounted by another agent',
        });
      }

      const existing = await ctx.connectorModel.findScopedByIdentifier(
        connector.identifier,
        input.agentId,
      );
      if (existing) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: `Agent already has a "${connector.identifier}" connector`,
        });
      }

      await ctx.connectorModel.update(input.connectorId, {
        metadata: { ...connector.metadata, mountedByAgentId: input.agentId },
      });
      return { id: input.connectorId };
    }),
  /** Unmount a connector from its agent (clears the reference lock). */
  unmountFromAgent: connectorWriteProcedure
    .input(z.object({ connectorId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const connector = await ctx.connectorModel.findById(input.connectorId);
      if (!connector) throw new TRPCError({ code: 'NOT_FOUND', message: 'Connector not found' });
      // Clearing the mount lock mutates the source row — creator/owner only.
      assertWorkspaceRowManageable(ctx, connector.userId, 'connector');

      const { mountedByAgentId: _drop, ...restMeta } = connector.metadata ?? {};
      await ctx.connectorModel.update(input.connectorId, { metadata: restMeta });
      return { id: input.connectorId };
    }),
};
