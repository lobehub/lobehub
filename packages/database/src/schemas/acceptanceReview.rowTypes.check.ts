import type {
  AcceptanceReview,
  AcceptanceReviewInsert,
  AcceptanceReviewMark,
  AcceptanceReviewMarkInsert,
} from '@lobechat/types';

import type { acceptanceReviewMarks, acceptanceReviews } from './acceptanceReview';

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Assert<T extends true> = T;

export type AcceptanceReviewRowTypesMatchSchema = [
  Assert<Equal<AcceptanceReview, typeof acceptanceReviews.$inferSelect>>,
  Assert<Equal<AcceptanceReviewInsert, typeof acceptanceReviews.$inferInsert>>,
  Assert<Equal<AcceptanceReviewMark, typeof acceptanceReviewMarks.$inferSelect>>,
  Assert<Equal<AcceptanceReviewMarkInsert, typeof acceptanceReviewMarks.$inferInsert>>,
];
