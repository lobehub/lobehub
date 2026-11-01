import {
  StaleUnderstandingRevisionError,
  StaleUnderstandingSessionError,
  UnderstandingPreconditionError,
  UnderstandingResourceNotFoundError,
  UnderstandingSessionNotFoundError,
} from '@lobechat/database';
import { errorNameFrom } from '@lobechat/utils';
import { TRPCError } from '@trpc/server';

import {
  StaleTaskRecommendationSessionError,
  TaskRecommendationNotFoundError,
} from '@/server/services/taskRecommendation/service';
import { UnderstandingWorkflowUnavailableError } from '@/server/workflows/onboardingUnderstanding';

/**
 * Maps an Understanding domain or workflow failure to its public tRPC representation.
 *
 * Use when:
 * - An onboarding Understanding procedure crosses the service-to-tRPC boundary
 *
 * Expects:
 * - An error caught from middleware, including an existing tRPC error
 *
 * Returns:
 * - The original tRPC error or a domain-aware tRPC error retaining the original cause
 */
export const mapUnderstandingTRPCError = (error: unknown): TRPCError => {
  if (error instanceof TRPCError) return error;

  if (
    error instanceof UnderstandingResourceNotFoundError ||
    error instanceof UnderstandingSessionNotFoundError
  ) {
    return new TRPCError({
      cause: error,
      code: 'NOT_FOUND',
      message: 'Onboarding understanding was not found',
    });
  }

  if (
    error instanceof StaleUnderstandingRevisionError ||
    error instanceof StaleUnderstandingSessionError
  ) {
    return new TRPCError({
      cause: error,
      code: 'CONFLICT',
      message: 'Onboarding understanding is no longer current',
    });
  }

  if (error instanceof UnderstandingPreconditionError) {
    return new TRPCError({
      cause: error,
      code: 'PRECONDITION_FAILED',
      message: 'Onboarding understanding action is not currently available',
    });
  }

  if (error instanceof UnderstandingWorkflowUnavailableError) {
    return new TRPCError({
      cause: error,
      code: 'PRECONDITION_FAILED',
      message: 'Onboarding understanding workflow is unavailable',
    });
  }

  console.error('[user:onboardingUnderstanding]', {
    errorName: errorNameFrom(error) ?? 'UnknownError',
  });
  return new TRPCError({
    cause: error,
    code: 'INTERNAL_SERVER_ERROR',
    message: 'Unable to process onboarding understanding request',
  });
};

/**
 * Maps a task recommendation domain failure to its public tRPC representation.
 *
 * Use when:
 * - An onboarding task recommendation procedure crosses the service-to-tRPC boundary
 *
 * Expects:
 * - An error caught from middleware, including an existing tRPC error
 *
 * Returns:
 * - The original tRPC error or a domain-aware tRPC error retaining the original cause
 */
export const mapTaskRecommendationTRPCError = (error: unknown): TRPCError => {
  if (error instanceof TRPCError) return error;

  if (error instanceof TaskRecommendationNotFoundError) {
    return new TRPCError({
      cause: error,
      code: 'NOT_FOUND',
      message: 'Onboarding task recommendations not found',
    });
  }

  if (error instanceof StaleTaskRecommendationSessionError) {
    return new TRPCError({
      cause: error,
      code: 'CONFLICT',
      message: 'Onboarding task recommendations are no longer current',
    });
  }

  console.error('[user:onboardingTaskRecommendations]', {
    errorName: errorNameFrom(error) ?? 'UnknownError',
  });
  return new TRPCError({
    cause: error,
    code: 'INTERNAL_SERVER_ERROR',
    message: 'Unable to process onboarding task recommendations',
  });
};
