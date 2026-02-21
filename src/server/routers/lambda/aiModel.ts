import { type AiProviderModelListItem } from 'model-bank';
import {
  AiModelTypeSchema,
  CreateAiModelSchema,
  ToggleAiModelEnableSchema,
  UpdateAiModelSchema,
} from 'model-bank';
import { z } from 'zod';

import { AiModelModel } from '@/database/models/aiModel';
import { UserModel } from '@/database/models/user';
import { AiInfraRepos } from '@/database/repositories/aiInfra';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { getServerGlobalConfig } from '@/server/globalConfig';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import { type ProviderConfig } from '@/types/user/settings';

const aiModelProcedure = authedProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;

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
    .input(z.object({ providerId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      return ctx.aiModelModel.clearModelsByProvider(input.providerId);
    }),
  clearRemoteModels: aiModelProcedure
    .input(z.object({ providerId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      return ctx.aiModelModel.clearRemoteModels(input.providerId);
    }),

  createAiModel: aiModelProcedure.input(CreateAiModelSchema).mutation(async ({ input, ctx }) => {
    const data = await ctx.aiModelModel.create(input);

    return data?.id;
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
      }),
    )
    .query(async ({ ctx, input }): Promise<AiProviderModelListItem[]> => {
      return ctx.aiInfraRepos.getAiProviderModelList(input.id, {
        enabled: input.enabled,
        limit: input.limit,
        offset: input.offset,
      });
    }),

  removeAiModel: aiModelProcedure
    .input(z.object({ id: z.string(), providerId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      return ctx.aiModelModel.delete(input.id, input.providerId);
    }),

  toggleModelEnabled: aiModelProcedure
    .input(ToggleAiModelEnableSchema)
    .mutation(async ({ input, ctx }) => {
      return ctx.aiModelModel.toggleModelEnabled(input);
    }),

  updateAiModel: aiModelProcedure
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
