/**
 * What a device picker shows for the pool the current agent can pick from.
 *
 * Use when:
 * - A picker filters the device list down to one pool (scope / visibility)
 *   and must decide between rows, a loading line, an error, or an empty hint
 *
 * Returns:
 * - `devices` whenever the pool has rows, stored or confirmed
 * - `empty` only once the server confirmed the list: a stored copy without
 *   rows for this pool may be stale or capped, so it is not proof of absence
 * - `error` when that unconfirmed pool's refresh failed (and no retry is in flight)
 * - `loading` otherwise
 */
export const getDevicePoolStatus = ({
  error,
  isConfirmed,
  isValidating,
  rowCount,
}: {
  error: unknown;
  isConfirmed: boolean;
  isValidating: boolean;
  rowCount: number;
}): 'devices' | 'empty' | 'error' | 'loading' => {
  if (rowCount > 0) return 'devices';
  if (isConfirmed) return 'empty';
  if (error && !isValidating) return 'error';
  return 'loading';
};
