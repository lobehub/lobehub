import type { ComponentType } from 'react';

let FramesView: ComponentType | undefined;

/**
 * The frames board renders Canvas references, so it needs the Canvas runtime
 * that only the main app bundles. The acceptance viewer is shared with builds
 * that lack it (the public share app shows acceptances in its portal), so the
 * board is registered by the main app on start-up instead of imported here;
 * where nothing registers it, the frames tab does not appear.
 */
export const registerAcceptanceFramesView = (view: ComponentType) => {
  FramesView = view;
};

export const getAcceptanceFramesView = () => FramesView;
