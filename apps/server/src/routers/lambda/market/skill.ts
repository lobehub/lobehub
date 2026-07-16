import { TRPCError } from '@trpc/server';
import debug from 'debug';
import { z } from 'zod';

import { publicProcedure, router } from '@/libs/trpc/lambda';
import { marketUserInfo, serverDatabase } from '@/libs/trpc/lambda/middleware';
import { MarketService } from '@/server/services/market';
import { SkillSorts } from '@/types/discover';

const log = debug('lambda-router:market:skill');

/** How many related skills the detail endpoint returns alongside the skill itself */
const RELATED_SKILLS_COUNT = 6;

// Public procedure with optional user info for trusted client token
const marketProcedure = publicProcedure
  .use(serverDatabase)
  .use(marketUserInfo)
  .use(async ({ ctx, next }) => {
    return next({
      ctx: {
        marketService: new MarketService({
          accessToken: ctx.marketAccessToken,
          userInfo: ctx.marketUserInfo,
        }),
      },
    });
  });

export const skillRouter = router({
  getSkillCategories: marketProcedure
    .input(
      z
        .object({
          locale: z.string().optional(),
          q: z.string().optional(),
        })
        .optional(),
    )
    .query(async ({ input, ctx }) => {
      log('getSkillCategories input: %O', input);

      try {
        return await ctx.marketService.getSkillCategories();
      } catch (error) {
        log('Error fetching skill categories: %O', error);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to fetch skill categories',
        });
      }
    }),

  getSkillComments: marketProcedure
    .input(
      z.object({
        identifier: z.string(),
        order: z.enum(['asc', 'desc']).optional(),
        page: z.number().optional(),
        pageSize: z.number().optional(),
        sort: z.enum(['createdAt', 'upvotes']).optional(),
      }),
    )
    .query(async ({ input, ctx }) => {
      log('getSkillComments input: %O', input);

      try {
        const { identifier, ...params } = input;
        return await ctx.marketService.getSkillComments(identifier, params);
      } catch (error) {
        log('Error fetching skill comments: %O', error);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to fetch skill comments',
        });
      }
    }),

  getSkillDetail: marketProcedure
    .input(
      z.object({
        identifier: z.string(),
        locale: z.string().optional(),
        version: z.string().optional(),
      }),
    )
    .query(async ({ input, ctx }) => {
      log('getSkillDetail input: %O', input);

      try {
        const detail = await ctx.marketService.getSkillDetail(input.identifier, {
          locale: input.locale,
          version: input.version,
        });

        // Related skills are decoration — never fail the detail because of them
        const related = detail.category
          ? await ctx.marketService
              .searchSkill({
                category: detail.category,
                locale: input.locale,
                page: 1,
                pageSize: 7,
                sort: 'recommended',
              })
              .then((list) =>
                list.items
                  .filter((item) => item.identifier !== detail.identifier)
                  .slice(0, RELATED_SKILLS_COUNT),
              )
              .catch(() => undefined)
          : undefined;

        return {
          ...detail,
          downloadUrl: ctx.marketService.getSkillDownloadUrl(input.identifier, input.version),
          related,
        };
      } catch (error) {
        log('Error fetching skill detail: %O', error);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to fetch skill detail',
        });
      }
    }),

  getSkillList: marketProcedure
    .input(
      z
        .object({
          category: z.string().optional(),
          locale: z.string().optional(),
          order: z.enum(['asc', 'desc']).optional(),
          page: z.number().optional(),
          pageSize: z.number().optional(),
          q: z.string().optional(),
          sort: z.nativeEnum(SkillSorts).optional(),
        })
        .optional(),
    )
    .query(async ({ input, ctx }) => {
      log('getSkillList input: %O', input);

      try {
        return await ctx.marketService.searchSkill(input ?? {});
      } catch (error) {
        log('Error fetching skill list: %O', error);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to fetch skill list',
        });
      }
    }),

  getSkillRatingDistribution: marketProcedure
    .input(z.object({ identifier: z.string() }))
    .query(async ({ input, ctx }) => {
      log('getSkillRatingDistribution input: %O', input);

      try {
        return await ctx.marketService.getSkillRatingDistribution(input.identifier);
      } catch (error) {
        log('Error fetching skill rating distribution: %O', error);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to fetch skill rating distribution',
        });
      }
    }),
});
