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
