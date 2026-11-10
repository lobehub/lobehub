/** Where every project keeps its repository checkouts on the drive. */
export const PROJECT_DRIVE_ROOT = 'projects';

const toSegment = (value: string) =>
  value
    .trim()
    .replaceAll(/[^\w.-]+/g, '-')
    .replaceAll(/^[.-]+|-+$/g, '');

/**
 * A project's checkout of one repository on the drive: one folder per project
 * and repository, shared by every conversation in the project, so work done in
 * one is there for the next — the way a local clone is.
 *
 * Keyed by the project's id rather than its slug: a renamed project must keep
 * its checkout, not start a fresh clone beside the old one.
 */
export const projectCheckoutDirectory = (projectId: string, repositoryName: string) => {
  const repository = toSegment(repositoryName.split('/').pop() ?? '') || 'repository';

  return `${PROJECT_DRIVE_ROOT}/${toSegment(projectId)}/${repository}`;
};
