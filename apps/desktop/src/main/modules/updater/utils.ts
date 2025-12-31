import semver from 'semver';

/**
 * Determine whether an application update is needed rather than just a renderer update
 * @param currentVersion Current version
 * @param nextVersion New version
 * @returns Whether application update is required
 */
export const shouldUpdateApp = (currentVersion: string, nextVersion: string): boolean => {
  // If version includes .app suffix, force application update
  if (nextVersion.includes('.app')) {
    return true;
  }

  try {
    // Parse version numbers
    const current = semver.parse(currentVersion);
    const next = semver.parse(nextVersion);

    if (!current || !next) return true;

    // When major or minor version changes, application update is required
    if (current.major !== next.major || current.minor !== next.minor) {
      return true;
    }

    // For patch version changes only, prefer renderer hot update
    return false;
  } catch {
    // Default to application update on parse failure
    return true;
  }
};
