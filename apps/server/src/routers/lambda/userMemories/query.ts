import type { QueryTaxonomyOptionsResult } from '@lobechat/types';
import { LayersEnum, queryTaxonomyOptionsSchema } from '@lobechat/types';
import { z } from 'zod';

import { router } from '@/libs/trpc/lambda';

import { memoryProcedure, memorySearchProcedure } from './procedures';
import { rethrowCandidateSearchError } from './utils';

const EMPTY_TAXONOMY_RESULT: QueryTaxonomyOptionsResult = {
  categories: [],
  hasMore: {},
  labels: [],
  relationships: [],
  roles: [],
  statuses: [],
  tags: [],
  types: [],
};

export const queryRouter = router({
  getMemoryDetail: memoryProcedure
    .input(z.object({ id: z.string(), layer: z.nativeEnum(LayersEnum) }))
    .query(async ({ ctx, input }) => {
      try {
        return await ctx.memoryModel.getMemoryDetail(input);
      } catch (error) {
        console.error('Failed to retrieve memory detail:', error);
        return null;
      }
    }),
  queryActivities: memorySearchProcedure
    .input(
      z
        .object({
          order: z.enum(['asc', 'desc']).optional(),
          page: z.coerce.number().int().min(1).optional(),
          pageSize: z.coerce.number().int().min(1).max(100).optional(),
          q: z.string().optional(),
          sort: z.enum(['capturedAt', 'startsAt']).optional(),
          status: z.array(z.string()).optional(),
          tags: z.array(z.string()).optional(),
          types: z.array(z.string()).optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const params = input ?? {};
      const fallbackPage = params.page ?? 1;
      const fallbackPageSize = params.pageSize ?? 20;

      try {
        return await ctx.activityModel.queryList(params);
      } catch (error) {
        rethrowCandidateSearchError(error);
        console.error('Failed to query activities:', error);
        return { items: [], page: fallbackPage, pageSize: fallbackPageSize, total: 0 };
      }
    }),
  queryExperiences: memorySearchProcedure
    .input(
      z
        .object({
          order: z.enum(['asc', 'desc']).optional(),
          page: z.coerce.number().int().min(1).optional(),
          pageSize: z.coerce.number().int().min(1).max(100).optional(),
          q: z.string().optional(),
          sort: z.enum(['capturedAt', 'scoreConfidence']).optional(),
          tags: z.array(z.string()).optional(),
          types: z.array(z.string()).optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const params = input ?? {};
      const fallbackPage = params.page ?? 1;
      const fallbackPageSize = params.pageSize ?? 20;

      try {
        return await ctx.experienceModel.queryList(params);
      } catch (error) {
        rethrowCandidateSearchError(error);
        console.error('Failed to query experiences:', error);
        return { items: [], page: fallbackPage, pageSize: fallbackPageSize, total: 0 };
      }
    }),
  queryIdentities: memorySearchProcedure
    .input(
      z
        .object({
          order: z.enum(['asc', 'desc']).optional(),
          page: z.coerce.number().int().min(1).optional(),
          pageSize: z.coerce.number().int().min(1).max(100).optional(),
          q: z.string().optional(),
          relationships: z.array(z.string()).optional(),
          sort: z.enum(['capturedAt', 'type']).optional(),
          tags: z.array(z.string()).optional(),
          types: z.array(z.string()).optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const params = input ?? {};
      const fallbackPage = params.page ?? 1;
      const fallbackPageSize = params.pageSize ?? 20;

      try {
        return await ctx.identityModel.queryList(params);
      } catch (error) {
        rethrowCandidateSearchError(error);
        console.error('Failed to query identities:', error);
        return { items: [], page: fallbackPage, pageSize: fallbackPageSize, total: 0 };
      }
    }),
  queryIdentitiesForInjection: memoryProcedure
    .input(z.object({ limit: z.coerce.number().int().min(1).max(100).optional() }).optional())
    .query(async ({ ctx, input }) => {
      try {
        return await ctx.identityModel.queryForInjection(input?.limit ?? 50);
      } catch (error) {
        console.error('Failed to query identities for injection:', error);
        return [];
      }
    }),
  queryIdentityRoles: memoryProcedure
    .input(
      z
        .object({
          page: z.coerce.number().int().min(1).optional(),
          size: z.coerce.number().int().min(1).max(100).optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      try {
        return await ctx.memoryModel.queryIdentityRoles(input ?? {});
      } catch (error) {
        console.error('Failed to query identity roles:', error);
        return { roles: [], tags: [] };
      }
    }),
  queryMemories: memorySearchProcedure
    .input(
      z
        .object({
          categories: z.array(z.string()).optional(),
          layer: z.nativeEnum(LayersEnum).optional(),
          order: z.enum(['asc', 'desc']).optional(),
          page: z.coerce.number().int().min(1).optional(),
          pageSize: z.coerce.number().int().min(1).max(100).optional(),
          q: z.string().optional(),
          sort: z
            .enum([
              'capturedAt',
              'scoreConfidence',
              'scoreImpact',
              'scorePriority',
              'scoreUrgency',
              'startsAt',
            ])
            .optional(),
          status: z.array(z.string()).optional(),
          tags: z.array(z.string()).optional(),
          types: z.array(z.string()).optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const params = input ?? {};
      const fallbackPage = params.page ?? 1;
      const fallbackPageSize = params.pageSize ?? 20;

      try {
        return await ctx.memoryModel.queryMemories({
          ...params,
          order: params.order ?? 'desc',
          sort: params.sort,
        });
      } catch (error) {
        rethrowCandidateSearchError(error);
        console.error('Failed to query memories:', error);
        return { items: [], page: fallbackPage, pageSize: fallbackPageSize, total: 0 };
      }
    }),
  queryTags: memoryProcedure
    .input(
      z
        .object({
          layers: z.array(z.nativeEnum(LayersEnum)).optional(),
          page: z.coerce.number().int().min(1).optional(),
          size: z.coerce.number().int().min(1).max(100).optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      try {
        return await ctx.memoryModel.queryTags(input ?? {});
      } catch (error) {
        console.error('Failed to query memory tags:', error);
        return [];
      }
    }),
  queryTaxonomyOptions: memoryProcedure
    .input(queryTaxonomyOptionsSchema.optional())
    .query(async ({ ctx, input }) => {
      try {
        return await ctx.memoryModel.queryTaxonomyOptions(input ?? {});
      } catch (error) {
        console.error('Failed to query memory taxonomy options:', error);
        return EMPTY_TAXONOMY_RESULT;
      }
    }),
});
