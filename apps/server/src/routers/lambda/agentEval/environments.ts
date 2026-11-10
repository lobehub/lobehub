import type { EvalCaseEnvironment } from '@lobechat/types';
import { redactEnvironmentConnections } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import {
  AgentEvalEnvironmentBindingError,
  hasSameEvalConnectorBindings,
} from '@/database/models/agentEval/environment';
import { router } from '@/libs/trpc/lambda';

import { validateEvalConnectorBindings } from './connectorBindings';
import { agentEvalProcedure, agentEvalProcedureWrite } from './procedures';
import { evalCaseEnvironmentSchema } from './schemas';

/**
 * Stored connections are written only by import and the Dataset connection API.
 * Clients get redacted copies and may send them back unchanged: drop them here.
 */
const environmentConfigInput = z.preprocess((value) => {
  if (!value || typeof value !== 'object' || !('connections' in value)) return value;
  const { connections: _redacted, ...config } = value as Record<string, unknown>;
  return config;
}, evalCaseEnvironmentSchema);

/** An Environment row as it leaves the server: connection credentials removed. */
const redacted = <T extends { config: EvalCaseEnvironment } | null | undefined>(row: T): T =>
  row ? { ...row, config: redactEnvironmentConnections(row.config) } : row;

/**
 * Reusable case environments: the Agent setup, Memory fixture, clock and mock
 * connectors that many cases share. Cases point at one through
 * `environmentId`; deleting an environment leaves its cases without one.
 */
export const environmentRouter = router({
  createEnvironment: agentEvalProcedureWrite
    .input(
      z.object({
        config: environmentConfigInput,
        description: z.string().optional(),
        identifier: z.string().trim().min(1).max(200).optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
        name: z.string().trim().min(1).max(200),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      try {
        await validateEvalConnectorBindings(
          ctx.evalConnectorServiceForDataset,
          input.config.connectorBindings,
        );
        return redacted(await ctx.environmentModel.create(input));
      } catch (error: any) {
        const pgError = error?.cause || error;
        if (pgError?.code === '23505') {
          throw new TRPCError({
            code: 'CONFLICT',
            message: `Environment with identifier "${input.identifier}" already exists`,
          });
        }
        throw error;
      }
    }),
  listEnvironments: agentEvalProcedure.query(async ({ ctx }) =>
    (await ctx.environmentModel.query()).map(redacted),
  ),
  getEnvironment: agentEvalProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const environment = await ctx.environmentModel.findById(input.id);
      if (!environment)
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Environment not found' });
      return redacted(environment);
    }),
  updateEnvironment: agentEvalProcedureWrite
    .input(
      z.object({
        config: environmentConfigInput.optional(),
        description: z.string().nullish(),
        id: z.string(),
        identifier: z.string().trim().min(1).max(200).nullish(),
        metadata: z.record(z.string(), z.unknown()).nullish(),
        name: z.string().trim().min(1).max(200).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { id, ...data } = input;
      if (data.config?.connectorBindings !== undefined) {
        const current = await ctx.environmentModel.findById(id);
        if (
          !hasSameEvalConnectorBindings(
            data.config.connectorBindings,
            current?.config.connectorBindings,
          )
        )
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Manage evaluation connections within their Dataset.',
          });
      }
      let result;
      try {
        result = await ctx.environmentModel.update(id, data);
      } catch (error) {
        if (error instanceof AgentEvalEnvironmentBindingError)
          throw new TRPCError({ code: 'CONFLICT', message: error.message });
        throw error;
      }
      if (!result) throw new TRPCError({ code: 'NOT_FOUND', message: 'Environment not found' });
      return redacted(result);
    }),
  deleteEnvironment: agentEvalProcedureWrite
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const result = await ctx.environmentModel.delete(input.id);
      return { success: (result.rowCount ?? 0) > 0 };
    }),
});
