import { useUserStore } from '@/store/user';
import { labPreferSelectors } from '@/store/user/selectors';

/**
 * Whether the surfaces for reviewing what agents learned (Self-evolving page, My rules) are on.
 *
 * Labs → Self-evolving is the single switch for everything agents learn in the background, so
 * the review surfaces follow it exactly.
 *
 * `ready` is false until the user state (and so the Labs preference) has loaded; gated pages
 * should not show the "turn on in Labs" state before then.
 */
export const useSelfLearningSurface = () => {
  const ready = useUserStore((s) => s.isUserStateInit);
  const enabled = useUserStore(labPreferSelectors.enableSelfLearning);

  return { enabled, ready };
};
