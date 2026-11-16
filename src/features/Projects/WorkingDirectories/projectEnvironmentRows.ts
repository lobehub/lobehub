import type { SandboxEnvironment } from '@/store/sandbox';

/**
 * A project's environments, as the rows the environment settings list them
 * with. The project holds only the link; the row — repository, creator, when it
 * was made — is the configured environment itself, so both pages show the same
 * thing and an edit made on either shows up on both.
 *
 * A linked environment the caller's configured list does not hold (a
 * colleague's private one linked to a shared project) is returned separately,
 * since there is no row to show for it beyond the link.
 */
export const projectEnvironmentRows = <TLinked extends { id: string }>(
  linked: TLinked[],
  configured: SandboxEnvironment[],
): { configured: SandboxEnvironment[]; unlisted: TLinked[] } => {
  const byId = new Map(configured.map((environment) => [environment.id, environment]));
  const rows: SandboxEnvironment[] = [];
  const unlisted: TLinked[] = [];
  for (const environment of linked) {
    const row = byId.get(environment.id);
    if (row) rows.push(row);
    else unlisted.push(environment);
  }
  return { configured: rows, unlisted };
};

/**
 * Whether an environment listed both times changed in a way the project's own
 * projections denormalize (its name) or depend on (its visibility). Linking or
 * unlinking is not an edit: those refresh the project on their own.
 */
export const hasEditedEnvironment = (
  previous: Pick<SandboxEnvironment, 'id' | 'name' | 'visibility'>[],
  next: Pick<SandboxEnvironment, 'id' | 'name' | 'visibility'>[],
): boolean => {
  const before = new Map(previous.map((environment) => [environment.id, environment]));
  return next.some((environment) => {
    const old = before.get(environment.id);
    return !!old && (old.name !== environment.name || old.visibility !== environment.visibility);
  });
};
