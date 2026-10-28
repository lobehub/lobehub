import { useUserStore } from '@/store/user';

/**
 * Syncs the member's preference for the active workspace and reports whether
 * it is known yet (local copy or network, success or failure). Always true in
 * personal mode. Topic lists wait on it because the "only mine" filter lives
 * there — reading it early paints the unfiltered list first.
 */
export const useWorkspacePreferenceReady = (): boolean =>
  !useUserStore((s) => s.useFetchWorkspaceUserPreference)().isLoading;
