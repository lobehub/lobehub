import type { LoaderFunctionArgs } from 'react-router';

import { PRE_PAINT_HYDRATE_TIMEOUT, settleWithin } from '@/libs/replica/prePaint';
import { expertiseActions } from '@/store/expertise';

/**
 * Route loader for an agent's Self-evolving pages (`/agent/:aid/self-evolving/*`).
 *
 * Seeds the persisted portrait — and, on a lesson deep link, that lesson —
 * before the route commits, so the page paints the last copy instead of its
 * loader while IndexedDB answers.
 */
export const selfLearningLoader = async ({ params }: LoaderFunctionArgs): Promise<null> => {
  await settleWithin(
    Promise.all([
      params.aid ? expertiseActions.preHydrateOverview(params.aid) : undefined,
      params.lessonId ? expertiseActions.preHydrateLesson(params.lessonId) : undefined,
    ]),
    PRE_PAINT_HYDRATE_TIMEOUT,
  );

  return null;
};
