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
 * Keyed by the project's id rather than its slug, so a renamed project keeps its
 * checkout. Named after the repository for whoever browses the drive, with the
 * environment's id after it: two repositories of one name (`orgA/api`,
 * `orgB/api`) must not share a folder, or the second would run against the
 * first one's checkout — a filled folder is never initialized again.
 */
export const projectCheckoutDirectory = (
  projectId: string,
  environment: { id: string; name: string },
) => {
  const repository = toSegment(environment.name.split('/').pop() ?? '') || 'repository';
  const id = toSegment(environment.id).slice(0, 8);

  return `${PROJECT_DRIVE_ROOT}/${toSegment(projectId)}/${id ? `${repository}-${id}` : repository}`;
};
