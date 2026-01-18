import semver from 'semver';

/**
 * Determine if application update is needed rather than just renderer update
 * @param currentVersion Current version
 * @param nextVersion New version
 * @returns Whether application update is needed
 */
export const shouldUpdateApp = (currentVersion: string, nextVersion: string): boolean => {
  // If version contains .app suffix, force application update
  if (nextVersion.includes('.app')) {
    return true;
  }

  try {
    // Parse version number
    const current = semver.parse(currentVersion);
    const next = semver.parse(nextVersion);

    if (!current || !next) return true;

    // Application update needed when major or minor version changes
    if (current.major !== next.major || current.minor !== next.minor) {
      return true;
    }

    // For patch version changes only, prioritize renderer hot update
    return false;
  } catch {
    // Default to application update when parsing fails
    return true;
  }
};
