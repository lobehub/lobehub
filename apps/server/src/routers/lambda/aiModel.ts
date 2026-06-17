import { TRPCError } from '@trpc/server';
import { type AiProviderModelListItem } from 'model-bank';
import {
  AiModelTypeSchema,
  CreateAiModelSchema,
  ToggleAiModelEnableSchema,
  UpdateAiModelSchema,
} from 'model-bank';
import { z } from 'zod';

import { withScopedPermission } from '@/business/server/trpc-middlewares/rbacPermission';
import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import { AiModelModel } from '@/database/models/aiModel';
import { UserModel } from '@/database/models/user';
import { AiInfraRepos } from '@/database/repositories/aiInfra';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { getServerGlobalConfig } from '@/server/globalConfig';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import { type ProviderConfig } from '@/types/user/settings';

const AI_MODEL_UNIQUE_CONSTRAINT = 'ai_models_id_provider_id_user_id_unique';

const getPostgresErrorField = (error: unknown, field: 'code' | 'constraint') => {
  let current = error;

  while (current && typeof current === 'object') {
    const value = (current as Record<string, unknown>)[field];
    if (typeof value === 'string') return value;

    current = (current as { cause?: unknown }).cause;
  }
};

const isDuplicateAiModelError = (error: unknown) =>
  getPostgresErrorField(error, 'code') === '23505' &&
  getPostgresErrorField(error, 'constraint') === AI_MODEL_UNIQUE_CONSTRAINT;

const throwDuplicateAiModelError = (id: string): never => {
  throw new TRPCError({
    code: 'CONFLICT',
    message: `Model "${id}" already exists`,
  });
};

const aiModelProcedure = wsCompatProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  const wsId = ctx.workspaceId ?? undefined;

  const gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey();
  const { aiProvider } = await getServerGlobalConfig();

  return opts.next({
    ctx: {
      aiInfraRepos: new AiInfraRepos(
        ctx.serverDB,
        ctx.userId,
        aiProvider as Record<string, ProviderConfig>,
      ),
      aiModelModel: new AiModelModel(ctx.serverDB, ctx.userId),
      gateKeeper,
      userModel: new UserModel(ctx.serverDB, ctx.userId),
    },
  });
});

export const aiModelRouter = router({
  batchToggleAiModels: aiModelProcedure
    .use(withScopedPermission('ai_model:update'))
    .input(
      z.object({
        enabled: z.boolean(),
        id: z.string(),
        models: z.array(z.string()),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return ctx.aiModelModel.batchToggleAiModels(input.id, input.models, input.enabled);
    }),
  batchUpdateAiModels: aiModelProcedure
    .use(withScopedPermission('ai_model:update'))
    .input(
      z.object({
        id: z.string(),
        // TODO: Complete validation schema
        models: z.array(z.any()),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return ctx.aiModelModel.batchUpdateAiModels(input.id, input.models);
    }),

  clearModelsByProvider: aiModelProcedure
    .use(withScopedPermission('ai_model:delete'))
    .input(z.object({ providerId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      return ctx.aiModelModel.clearModelsByProvider(input.providerId);
    }),
  clearRemoteModels: aiModelProcedure
    .use(withScopedPermission('ai_model:delete'))
    .input(z.object({ providerId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      return ctx.aiModelModel.clearRemoteModels(input.providerId);
    }),

  createAiModel: aiModelProcedure
    .use(withScopedPermission('ai_model:create'))
    .input(CreateAiModelSchema)
    .mutation(async ({ input, ctx }) => {
      const existingModel = await ctx.aiModelModel.findByIdAndProvider(input.id, input.providerId);
      if (existingModel) throwDuplicateAiModelError(input.id);

      try {
        const data = await ctx.aiModelModel.create(input);

        return data?.id;
      } catch (error) {
        if (isDuplicateAiModelError(error)) throwDuplicateAiModelError(input.id);

        throw error;
      }
    }),

  getAiModelById: aiModelProcedure
    .input(z.object({ id: z.string() }))

    .query(async ({ input, ctx }) => {
      return ctx.aiModelModel.findById(input.id);
    }),

  getAiProviderModelList: aiModelProcedure
    .input(
      z.object({
        enabled: z.boolean().optional(),
        id: z.string(),
        limit: z.number().int().min(1).max(200).optional(),
        offset: z.number().int().min(0).optional(),
        type: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }): Promise<AiProviderModelListItem[]> => {
      return ctx.aiInfraRepos.getAiProviderModelList(input.id, {
        enabled: input.enabled,
        limit: input.limit,
        offset: input.offset,
        type: input.type,
      });
    }),

  removeAiModel: aiModelProcedure
    .use(withScopedPermission('ai_model:delete'))
    .input(z.object({ id: z.string(), providerId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      return ctx.aiModelModel.delete(input.id, input.providerId);
    }),

  toggleModelEnabled: aiModelProcedure
    .use(withScopedPermission('ai_model:update'))
    .input(ToggleAiModelEnableSchema)
    .mutation(async ({ input, ctx }) => {
      return ctx.aiModelModel.toggleModelEnabled(input);
    }),

  updateAiModel: aiModelProcedure
    .use(withScopedPermission('ai_model:update'))
    .input(
      z.object({
        id: z.string(),
        providerId: z.string(),
        value: UpdateAiModelSchema,
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return ctx.aiModelModel.update(input.id, input.providerId, input.value);
    }),

  updateAiModelOrder: aiModelProcedure
    .use(withScopedPermission('ai_model:update'))
    .input(
      z.object({
        providerId: z.string(),
        sortMap: z.array(
          z.object({
            id: z.string(),
            sort: z.number(),
            type: AiModelTypeSchema.optional(),
          }),
        ),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return ctx.aiModelModel.updateModelsOrder(input.providerId, input.sortMap);
    }),
});

export type AiModelRouter = typeof aiModelRouter;
