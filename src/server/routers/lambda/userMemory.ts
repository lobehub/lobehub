import { CreateUserMemoryIdentitySchema, UpdateUserMemoryIdentitySchema } from '@lobechat/types';
import { z } from 'zod';

import { UserMemoryModel } from '@/database/models/userMemory';
import {
  UserMemoryContextModel,
  UserMemoryExperienceModel,
  UserMemoryIdentityModel,
  UserMemoryPreferenceModel,
} from '@/database/models/userMemory/index';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';

const userMemoryProcedure = authedProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;

  return opts.next({
    ctx: {
      contextModel: new UserMemoryContextModel(ctx.serverDB, ctx.userId),
      experienceModel: new UserMemoryExperienceModel(ctx.serverDB, ctx.userId),
      identityModel: new UserMemoryIdentityModel(ctx.serverDB, ctx.userId),
      preferenceModel: new UserMemoryPreferenceModel(ctx.serverDB, ctx.userId),
      userMemoryModel: new UserMemoryModel(ctx.serverDB, ctx.userId),
    },
  });
});

export const userMemoryRouter = router({
  // ============ Identity CRUD ============
  createIdentity: userMemoryProcedure
    .input(CreateUserMemoryIdentitySchema)
    .mutation(async ({ ctx, input }) => {
      return ctx.userMemoryModel.addIdentityEntry({
        base: {},
        identity: {
          description: input.description,
          episodicDate: input.episodicDate,
          relationship: input.relationship,
          role: input.role,
          tags: input.extractedLabels,
          type: input.type,
        },
      });
    }),

  // ============ Context CRUD ============
  deleteContext: userMemoryProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      return ctx.contextModel.delete(input.id);
    }),

  // ============ Experience CRUD ============
  deleteExperience: userMemoryProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      return ctx.experienceModel.delete(input.id);
    }),

  deleteIdentity: userMemoryProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      return ctx.userMemoryModel.removeIdentityEntry(input.id);
    }),

  // ============ Preference CRUD ============
  deletePreference: userMemoryProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      return ctx.preferenceModel.delete(input.id);
    }),

  getContexts: userMemoryProcedure.query(async ({ ctx }) => {
    return ctx.userMemoryModel.searchContexts({});
  }),

  getExperiences: userMemoryProcedure.query(async ({ ctx }) => {
    return ctx.userMemoryModel.searchExperiences({});
  }),

  getIdentities: userMemoryProcedure.query(async ({ ctx }) => {
    return ctx.userMemoryModel.getAllIdentities();
  }),

  // ============ Persona ============
  getPersona: userMemoryProcedure.query(async () => {
    return { content: '', summary: '' };
  }),

  getPreferences: userMemoryProcedure.query(async ({ ctx }) => {
    return ctx.userMemoryModel.searchPreferences({});
  }),

  updateContext: userMemoryProcedure
    .input(
      z.object({
        data: z.object({
          currentStatus: z.string().optional(),
          description: z.string().optional(),
          title: z.string().optional(),
        }),
        id: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.contextModel.update(input.id, input.data);
    }),

  updateExperience: userMemoryProcedure
    .input(
      z.object({
        data: z.object({
          action: z.string().optional(),
          keyLearning: z.string().optional(),
          situation: z.string().optional(),
        }),
        id: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.experienceModel.update(input.id, input.data);
    }),

  updateIdentity: userMemoryProcedure
    .input(
      z.object({
        data: UpdateUserMemoryIdentitySchema,
        id: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.userMemoryModel.updateIdentityEntry({
        identity: {
          description: input.data.description,
          episodicDate: input.data.episodicDate,
          relationship: input.data.relationship,
          role: input.data.role,
          tags: input.data.extractedLabels,
          type: input.data.type,
        },
        identityId: input.id,
      });
    }),

  updatePreference: userMemoryProcedure
    .input(
      z.object({
        data: z.object({
          conclusionDirectives: z.string().optional(),
          suggestions: z.string().optional(),
        }),
        id: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.preferenceModel.update(input.id, input.data);
    }),
});

export type UserMemoryRouter = typeof userMemoryRouter;
