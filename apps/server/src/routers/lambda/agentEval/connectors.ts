import { randomUUID } from 'node:crypto';

import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import type { PublicConnectorRecord } from '@/database/models/connector';
import {
  EvalConnectorUpdateError,
  normalizeEvalConnectorPatch,
} from '@/database/models/connectorEval';
import { router } from '@/libs/trpc/lambda';
import { syncConnectorToolsById } from '@/server/services/connector/sync';

import { agentEvalProcedure, agentEvalProcedureWrite } from './procedures';

const datasetInput = z.object({ datasetId: z.string().min(1) });
const connectorInput = datasetInput.extend({ id: z.string().uuid() });
const credentialsInput = z.discriminatedUnion('type', [
  z.object({ token: z.string().min(1), type: z.literal('bearer') }),
  z.object({ headers: z.record(z.string(), z.string()), type: z.literal('header') }),
]);
const editableInput = z.object({
  credentials: credentialsInput.nullish(),
  isEnabled: z.boolean().optional(),
  mcpServerUrl: z.string().url(),
  name: z.string().trim().min(1).max(255),
});

/** Only explicit management fields leave this API; credentials and metadata never do. */
const toManagementRecord = (record: PublicConnectorRecord) => ({
  hasCredentials: record.hasCredentials,
  id: record.id,
  isEnabled: record.isEnabled,
  mcpConnectionType: record.mcpConnectionType,
  mcpServerUrl: record.mcpServerUrl,
  name: record.name,
  status: record.status,
});

const mapEditError = (error: unknown): never => {
  if (error instanceof EvalConnectorUpdateError)
    throw new TRPCError({ code: 'BAD_REQUEST', message: error.message });
  throw error;
};

export const evalConnectorRouter = router({
  createEvalConnector: agentEvalProcedureWrite
    .input(datasetInput.merge(editableInput))
    .mutation(async ({ ctx, input }) => {
      const { connectorModel } = await ctx.evalConnectorModelsForDataset(input.datasetId);
      const metadata = { agentEval: { datasetId: input.datasetId } };
      try {
        const patch = await normalizeEvalConnectorPatch(
          { credentials: null, metadata, mcpServerUrl: null },
          {
            credentials: input.credentials ? JSON.stringify(input.credentials) : null,
            mcpServerUrl: input.mcpServerUrl,
          },
        );
        const row = await connectorModel.create({
          ...patch,
          identifier: `eval-mock-${randomUUID()}`,
          isEnabled: input.isEnabled ?? true,
          mcpConnectionType: 'http',
          metadata,
          name: input.name,
          sourceType: 'custom',
          status: 'disconnected',
        });
        return { id: row.id };
      } catch (error) {
        return mapEditError(error);
      }
    }),
  getEvalConnector: agentEvalProcedure.input(connectorInput).query(async ({ ctx, input }) => {
    const { connectorModel } = await ctx.evalConnectorModelsForDataset(input.datasetId);
    const record = await connectorModel.findPublicById(input.id);
    if (!record)
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Dataset connection not found' });
    return toManagementRecord(record);
  }),
  listEvalConnectors: agentEvalProcedure.input(datasetInput).query(async ({ ctx, input }) => {
    const { connectorModel } = await ctx.evalConnectorModelsForDataset(input.datasetId);
    return (await connectorModel.queryPublic()).map(toManagementRecord);
  }),
  testEvalConnector: agentEvalProcedureWrite
    .input(connectorInput)
    .mutation(async ({ ctx, input }) => {
      const models = await ctx.evalConnectorModelsForDataset(input.datasetId);
      if (!(await models.connectorModel.findPublicById(input.id)))
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Dataset connection not found' });
      try {
        return await syncConnectorToolsById(input.id, models, { pruneMissingAutoTools: true });
      } catch {
        // Upstream MCP errors may echo credentials, request headers or private addresses.
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Connection test failed. Check the address and authentication, then retry.',
        });
      }
    }),
  updateEvalConnector: agentEvalProcedureWrite
    .input(connectorInput.merge(editableInput))
    .mutation(async ({ ctx, input }) => {
      const { connectorModel } = await ctx.evalConnectorModelsForDataset(input.datasetId);
      if (!(await connectorModel.findPublicById(input.id)))
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Dataset connection not found' });
      try {
        await connectorModel.update(input.id, {
          isEnabled: input.isEnabled,
          credentials:
            input.credentials === undefined
              ? undefined
              : input.credentials === null
                ? null
                : JSON.stringify(input.credentials),
          mcpServerUrl: input.mcpServerUrl,
          name: input.name,
        });
        return { id: input.id };
      } catch (error) {
        return mapEditError(error);
      }
    }),
});
