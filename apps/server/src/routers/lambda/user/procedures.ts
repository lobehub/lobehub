import { errorCauseFrom } from '@lobechat/utils';
import { TRPCError } from '@trpc/server';

import { MessageModel } from '@/database/models/message';
import { SessionModel } from '@/database/models/session';
import { UserModel } from '@/database/models/user';
import { authedProcedure } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import {
  mapTaskRecommendationTRPCError,
  mapUnderstandingTRPCError,
} from '@/server/routers/lambda/_helpers/onboardingError';
import { FileService } from '@/server/services/file';
import { OnboardingService } from '@/server/services/onboarding';
import { createTaskRecommendationService } from '@/server/services/taskRecommendation/service';
import { createUnderstandingService } from '@/server/services/understanding/service';

export const userProcedure = authedProcedure.use(serverDatabase).use(async ({ ctx, next }) => {
  return next({
    ctx: {
      fileService: new FileService(ctx.serverDB, ctx.userId),
      // workspace-audit: intentionally personal-scoped (no workspaceId). These models
      // only feed `getUserState`'s user-lifetime onboarding gates (hasConversation /
      // canEnablePWAGuide / canEnableTrace), which are per-user, not per-workspace.
      messageModel: new MessageModel(ctx.serverDB, ctx.userId),
      createOnboardingService: () => new OnboardingService(ctx.serverDB, ctx.userId),
      sessionModel: new SessionModel(ctx.serverDB, ctx.userId),
      userModel: new UserModel(ctx.serverDB, ctx.userId),
    },
  });
});

const personalOnboardingProcedure = userProcedure.use(async ({ ctx, next }) => {
  if (ctx.workspaceId) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Onboarding is available only in personal scope',
    });
  }
  return next();
});

export const understandingServiceProcedure = personalOnboardingProcedure
  .use(async ({ next }) => {
    const result = await next();
    if (!result.ok) {
      throw mapUnderstandingTRPCError(errorCauseFrom(result.error) ?? result.error);
    }
    return result;
  })
  .use(async ({ ctx, next }) => {
    const understandingService = await createUnderstandingService({
      db: ctx.serverDB,
      userId: ctx.userId,
    });

    return next({ ctx: { understandingService } });
  });

export const taskRecommendationServiceProcedure = personalOnboardingProcedure.use(
  async ({ ctx, next }) => {
    const taskRecommendationService = await createTaskRecommendationService({
      db: ctx.serverDB,
      userId: ctx.userId,
    });
    const result = await next({ ctx: { taskRecommendationService } });
    if (!result.ok) {
      throw mapTaskRecommendationTRPCError(errorCauseFrom(result.error) ?? result.error);
    }
    return result;
  },
);

export const onboardingGenerationProgressProcedure = personalOnboardingProcedure.use(
  async ({ ctx, next }) => {
    const [understandingService, taskRecommendationService] = await Promise.all([
      createUnderstandingService({ db: ctx.serverDB, userId: ctx.userId }),
      createTaskRecommendationService({ db: ctx.serverDB, userId: ctx.userId }),
    ]);
    const result = await next({ ctx: { taskRecommendationService, understandingService } });
    if (!result.ok) {
      throw mapUnderstandingTRPCError(errorCauseFrom(result.error) ?? result.error);
    }
    return result;
  },
);
