// A nested boundary (layout chunk → page chunk) mounts its fallback in the same
// commit the parent's skeleton unmounts. Delaying it again blanks the pane the
// user is already reading a skeleton in, so a fallback that follows one within
// this window paints immediately.
export const HANDOVER_WINDOW = 400;

let lastSkeletonVisibleAt = -Infinity;

export const markSkeletonVisible = (now = performance.now()) => {
  lastSkeletonVisibleAt = now;
};

export const isSkeletonHandover = (now = performance.now()) =>
  now - lastSkeletonVisibleAt < HANDOVER_WINDOW;
