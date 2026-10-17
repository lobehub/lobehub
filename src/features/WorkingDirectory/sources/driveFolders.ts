/**
 * Pure helpers for the drive's folder listing, apart from React so the rules
 * the picker draws by can be tested on their own.
 */

/** A folder's parent on the drive; `null` at the root, `''` for a top-level folder. */
export const driveParentPath = (path: string): string | null => {
  if (!path) return null;
  const index = path.lastIndexOf('/');

  return index === -1 ? '' : path.slice(0, index);
};

/** A child path on the drive, from a parent (`''` is the root) and a name. */
export const joinDrivePath = (parentPath: string, name: string) =>
  parentPath ? `${parentPath}/${name}` : name;

/** How a drive path reads in the address field: rooted, like a mount. */
export const displayDrivePath = (path: string) => `/${path}`;

export interface DriveInstanceRow {
  buildId?: string | null;
  environmentId: string;
  id: string;
  inUse: boolean;
  inUseByThisTopic: boolean;
  name: string;
  status: string;
  workingDirectory: string;
}

export type EnvironmentDirectoryState = 'building' | 'failed' | 'inUse' | 'ready';

/**
 * What an environment directory's row says about it, and so whether picking
 * it would work: a build holds the directory until it settles, and another
 * conversation's run holds it until that run ends.
 */
export const environmentDirectoryState = (
  instance: Pick<DriveInstanceRow, 'buildId' | 'inUse' | 'inUseByThisTopic' | 'status'>,
): EnvironmentDirectoryState => {
  if (instance.status === 'pending') return 'building';
  if (instance.inUse && !instance.inUseByThisTopic) return 'inUse';
  if (instance.status === 'error') return 'failed';

  return 'ready';
};

/**
 * The environment directories among a listing's folders, by path. Only a
 * top-level folder can be one — environment directories always sit at the
 * root — so a deeper listing has none.
 */
export const environmentDirectoriesByPath = (
  listingPath: string,
  instances: DriveInstanceRow[],
): Map<string, DriveInstanceRow> =>
  listingPath
    ? new Map()
    : new Map(instances.map((instance) => [instance.workingDirectory, instance]));
