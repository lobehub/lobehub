/** A widget's path from authoring to live; each step after the draft asks for approval. */
export const REVIEW_STEPS = ['draft', 'dryRun', 'publish'] as const;

export type ReviewStep = (typeof REVIEW_STEPS)[number];

/** The approval a review card asks for; drafting itself never asks. */
export type ReviewStageStep = Exclude<ReviewStep, 'draft'>;

export type ReviewStepState = 'current' | 'done' | 'upcoming';

/** Every step of the path with where it stands while `stage` is being approved. */
export const reviewStepStates = (stage: ReviewStageStep) => {
  const currentIndex = REVIEW_STEPS.indexOf(stage);
  return REVIEW_STEPS.map((step, index) => ({
    state: (index < currentIndex
      ? 'done'
      : index === currentIndex
        ? 'current'
        : 'upcoming') as ReviewStepState,
    step,
  }));
};
