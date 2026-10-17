// A nested boundary (layout chunk → page chunk) mounts its fallback in the same
// commit the parent's skeleton unmounts. Delaying it again blanks the pane the
// user is already reading a skeleton in, so a fallback that follows one within
// this window paints immediately.
export const HANDOVER_WINDOW = 400;

let lastSkeletonVisibleAt = -Infinity;
let visibleSkeletons = 0;

export const markSkeletonVisible = (now = performance.now()) => {
  lastSkeletonVisibleAt = now;
};

// The next fallback renders before the previous one's unmount cleanup runs, so
// a skeleton that is still mounted has to count as visible on its own.
export const retainSkeleton = () => {
  visibleSkeletons += 1;
  markSkeletonVisible();
  return () => {
    visibleSkeletons -= 1;
    markSkeletonVisible();
  };
};

export const isSkeletonHandover = (now = performance.now()) =>
  visibleSkeletons > 0 || now - lastSkeletonVisibleAt < HANDOVER_WINDOW;
