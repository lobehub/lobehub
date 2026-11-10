/**
 * Core OTA builds are named `<appVersion>-core.<seq>`: the trailing segment is
 * the OTA pack sequence for that shell version — an implementation detail, not
 * something the user reads as a version. Every user-facing core version (the
 * About tag and the updater toast) goes through here so the segment is hidden
 * in one place.
 */
export const formatCoreVersion = (version: string): string => version.replace('-core.', '-');
