/**
 * The type label a list row shows. Each row reads its own app's type; a web
 * app must never be labelled with the device flow.
 */
export const appTypeLabelKey = (applicationType?: string | null) =>
  applicationType === 'web' ? ('oauthApp.type.web' as const) : ('oauthApp.type.device' as const);

export type AppListState = 'empty' | 'error' | 'list' | 'loading';

/**
 * Which body the app list renders. A failed fetch with nothing cached is a
 * failure (with Retry), never the "no apps yet" empty state; once a list is
 * cached, a failed revalidation keeps showing it.
 */
export const resolveAppListState = ({
  count,
  error,
  isLoading,
}: {
  count?: number;
  error?: unknown;
  isLoading: boolean;
}): AppListState => {
  if (count !== undefined) return count > 0 ? 'list' : 'empty';
  if (error) return 'error';
  if (isLoading) return 'loading';
  return 'empty';
};
