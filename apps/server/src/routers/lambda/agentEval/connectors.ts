import { randomUUID } from 'node:crypto';

import { parseEnvironmentConnectionId } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import type { PublicConnectorRecord } from '@/database/models/connector';
import {
  EvalConnectorUpdateError,
  normalizeEvalConnectorPatch,
} from '@/database/models/connectorEval';
import {
  AgentEvalEnvironmentConnectionError,
  type StoredEnvironmentConnection,
} from '@/database/repositories/agentEvalEnvironmentConnection';
import { router } from '@/libs/trpc/lambda';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import {
  EvalConnectorBindingError,
  getLobeBenchForwardingEndpoint,
} from '@/server/services/agentEvalConnector';
import { syncConnectorToolsById } from '@/server/services/connector/sync';

import { agentEvalProcedure, agentEvalProcedureWrite } from './procedures';

const datasetInput = z.object({ datasetId: z.string().min(1) });
// A connector row (uuid) or a connection stored in an Environment (`env:<environmentId>:<service>`).
const connectorInput = datasetInput.extend({
  id: z.union([
    z.string().uuid(),
    z.string().refine((id) => !!parseEnvironmentConnectionId(id), 'Invalid connection id'),
  ]),
});
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

/** A stored connection in the same management shape; it is always enabled. */
const toStoredManagementRecord = ({
  connection,
  connectorId,
  service,
}: StoredEnvironmentConnection) => ({
  hasCredentials: !!connection.credentials,
  id: connectorId,
  isEnabled: true,
  mcpConnectionType: 'http',
  mcpServerUrl: connection.url,
  name: connection.name ?? service,
  status: 'connected',
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
    if (parseEnvironmentConnectionId(input.id)) {
      const stored = await ctx.environmentConnections.find(input.datasetId, input.id);
      if (!stored)
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Dataset connection not found' });
      return toStoredManagementRecord(stored);
    }
    const record = await connectorModel.findPublicById(input.id);
    if (!record)
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Dataset connection not found' });
    return toManagementRecord(record);
  }),
  listEvalConnectors: agentEvalProcedure.input(datasetInput).query(async ({ ctx, input }) => {
    const { connectorModel } = await ctx.evalConnectorModelsForDataset(input.datasetId);
    const stored = await ctx.environmentConnections.listForDataset(input.datasetId);
    return [
      ...(await connectorModel.queryPublic()).map(toManagementRecord),
      ...stored.map(toStoredManagementRecord),
    ];
  }),
  testEvalConnector: agentEvalProcedureWrite
    .input(connectorInput)
    .mutation(async ({ ctx, input }) => {
      const models = await ctx.evalConnectorModelsForDataset(input.datasetId);
      if (parseEnvironmentConnectionId(input.id)) {
        try {
          return await ctx
            .evalConnectorServiceForDataset(input.datasetId)
            .testStoredConnection(input.id);
        } catch {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Connection test failed. Check the address and authentication, then retry.',
          });
        }
      }
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
      if (parseEnvironmentConnectionId(input.id)) {
        try {
          // A stored connection is always a LobeBench mock route.
          getLobeBenchForwardingEndpoint(input.mcpServerUrl);
          const credentials =
            input.credentials === undefined
              ? undefined
              : input.credentials === null
                ? null
                : await (
                    await KeyVaultsGateKeeper.initWithEnvKey()
                  ).encrypt(JSON.stringify(input.credentials));
          return await ctx.environmentConnections.update(input.datasetId, input.id, {
            credentials,
            name: input.name,
            url: input.mcpServerUrl,
          });
        } catch (error) {
          if (
            error instanceof AgentEvalEnvironmentConnectionError ||
            error instanceof EvalConnectorBindingError
          )
            throw new TRPCError({ code: 'BAD_REQUEST', message: error.message });
          throw error;
        }
      }
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
