// The person reading a local report is its only reviewer. Their decisions are
// stamped `decidedBy: 'local'` (see `localAcceptance.ts`), so the same id here
// lets the viewer label them as the reader's own.
const LOCAL_USER = { fullName: '', id: 'local', username: '' };

const emptyState = {
  isLoaded: true,
  isSignedIn: false,
  user: LOCAL_USER,
};

/**
 * `@/store/user` for the offline report. The real store boots the whole app
 * (agents, chat, model runtimes); the viewer only asks who is reading.
 */
export const useUserStore = <T = unknown>(selector?: (state: typeof emptyState) => T): T =>
  selector ? selector(emptyState) : (emptyState as T);

useUserStore.getState = () => emptyState;
useUserStore.subscribe = () => () => {};

export const getUserStoreState = () => emptyState;
