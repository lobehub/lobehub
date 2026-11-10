/** Where every project keeps its repository checkouts on the drive. */
export const PROJECT_DRIVE_ROOT = 'projects';

const toSegment = (value: string) =>
  value
    .trim()
    .replaceAll(/[^\w.-]+/g, '-')
    .replaceAll(/^[.-]+|-+$/g, '');

/**
 * A project's checkout of one repository on the drive: one folder per project
 * and environment, shared by every conversation in the project, so work done in
 * one is there for the next — the way a local clone is.
 *
 * Derived from ids alone. A name in the path would move the checkout whenever
 * the project or the environment is renamed, and the next conversation would
 * clone afresh beside the work already done; a repository's name alone would
 * also put `orgA/api` and `orgB/api` in one folder, and a filled folder is never
 * initialized again. Where the folder is shown, it is shown by the repository's
 * name, not its path.
 */
export const projectCheckoutDirectory = (projectId: string, environmentId: string) =>
  `${PROJECT_DRIVE_ROOT}/${toSegment(projectId)}/${toSegment(environmentId)}`;
