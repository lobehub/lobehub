/**
 * On a phone the evidence review is ONE page: the image on top, the notes it
 * earns directly underneath. The only mode left is whether a drag on the image
 * marks a region or pans it.
 */
export type MobileReviewStep = 'browse' | 'draw';

export type MobileReviewEvent =
  /** A region was just drawn on the image. */
  | 'region-drawn'
  /** Jump from a listed note back to its image, ready to adjust the region. */
  | 'edit-region'
  /** The draw / browse toggle under the image. */
  | 'toggle-draw';

/**
 * `region-drawn` deliberately holds the step still. Finishing a drag used to
 * leave the image for a separate note screen, which froze the box at whatever
 * shape the first drag produced — no way back to move, resize or delete it.
 */
export const nextMobileReviewStep = (
  step: MobileReviewStep,
  event: MobileReviewEvent,
): MobileReviewStep => {
  switch (event) {
    case 'region-drawn': {
      return step;
    }
    case 'edit-region': {
      return 'draw';
    }
    case 'toggle-draw': {
      return step === 'draw' ? 'browse' : 'draw';
    }
  }
};
