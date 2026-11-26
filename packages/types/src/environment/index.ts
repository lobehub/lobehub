/**
 * Who, inside a workspace, an environment resolves for.
 *
 * `private` is the default and the only meaning a personal environment has.
 * `public` lets every member of the workspace run in it — and therefore in its
 * instances, which carry whatever a session left in them.
 */
export type EnvironmentVisibility = 'private' | 'public';

/** Abstract source material; paths are relative destinations within an instance. */
export type EnvironmentSource =
  | {
      kind: 'git';
      path?: string;
      ref?: string;
      /**
       * Setup for this repository alone, run inside its folder once it is
       * checked out and before the environment's own
       * {@link EnvironmentConfiguration.bootstrapCommand}. Folded into that one
       * command by {@link withRepositorySetup} before anything reaches the
       * execution plane, which only knows the environment-wide one.
       */
      setupCommand?: string;
      url: string;
    }
  | { kind: 'files'; path?: string; uri: string };

export interface EnvironmentResourceRequirements {
  cpu?: number;
  gpu?: { count: number; memoryGiB?: number; model?: string };
  memoryGiB?: number;
}

/**
 * What an environment is for. New environments are `code` — checking out a
 * repository and running setup — since a folder someone hands files to is a
 * folder on the drive, not an environment. `files` is what the previous
 * release stored for such an environment; rows keep it and an edit sends it
 * back, so it stays a value the type admits. Presentation only: it never
 * reaches the execution plane.
 */
export type EnvironmentKind = 'code' | 'files';

/** Portable definition, shared by device, sandbox and cluster instances. No credentials. */
export interface EnvironmentConfiguration {
  bootstrapCommand?: string;
  /**
   * Non-secret values exported before anything else runs — a region, a mirror,
   * a feature switch. Credentials are excluded by the same rule that governs
   * the rest of this object: it is stored in plain text and copied into every
   * instance snapshot, so a token written here is a token in the database and
   * in every copy of it. Secrets are resolved by the runtime at use time.
   */
  env?: Record<string, string>;
  /**
   * Paths the author declares REGENERABLE, relative to an instance's own root.
   *
   * Not merely "skip these". What is named here is kept apart from the work
   * that cannot be remade, and what is kept apart may be discarded to reclaim
   * space — so a path listed here that cannot in fact be rebuilt is work its
   * owner can lose. Read it as a promise about the path, not an optimization.
   *
   * Declarative rather than a cleanup command run just before capture, which
   * deletes unattended and then immediately makes the result permanent.
   */
  excludePaths?: string[];
  /**
   * Whether work in this environment may reach the network. Omitted means the
   * adapter decides, which is not uniform: a sandbox runs connected so that a
   * bootstrap can install anything, while a device simply has whatever network
   * the machine has and cannot enforce a restriction at all.
   */
  internetAccess?: boolean;
  /**
   * Stored at creation; absent on environments made before there was one.
   * Stored with the rest of the definition but stripped from every copy sent
   * to the execution plane, so adding it changes no build's digest.
   */
  kind?: EnvironmentKind;
  /**
   * Run every time work resumes in an instance, after whatever was built is
   * restored — refreshing a checkout, reapplying a migration.
   *
   * Emphatically not {@link EnvironmentConfiguration.bootstrapCommand} run
   * again: bootstrap is what makes an empty instance usable and is expensive by
   * nature, so running it per task would discard the whole point of building
   * once. This is the short reconciliation that follows.
   */
  maintenanceCommand?: string;
  /**
   * Free-text notes for whoever picks where the work runs, the agent included:
   * what a run needs from a machine ("`dev` needs at least 8 GB of memory"),
   * which device suits which task. Read, not enforced — and, like
   * {@link EnvironmentConfiguration.kind}, the product's own, so it is stripped
   * before the execution plane digests the definition.
   */
  notes?: string;
  /** Requirements, not a selection of a particular machine or provider. */
  requirements?: EnvironmentResourceRequirements;
  sources?: EnvironmentSource[];
}

/**
 * Remote hosts connected through lh are devices too. A cluster instance runs
 * on infrastructure a cluster provider manages; a managed cloud device is one
 * (`provider: MANAGED_CLOUD_CLUSTER_PROVIDER_V1`, `providerScope`: region,
 * `providerResourceId`: managed device id — see `../managedDevice`).
 */
export type EnvironmentInstanceKind = 'device' | 'sandbox' | 'cluster';

export type EnvironmentInstanceStatus = 'pending' | 'ready' | 'stopped' | 'error';

/** Instance-specific choices. Actual resource observation belongs to the runtime adapter. */
export interface EnvironmentInstanceConfiguration {
  /** Omitted means no automatic idle shutdown is requested. */
  idleTimeoutSeconds?: number;
  image?: string;
  resources?: EnvironmentResourceRequirements;
}

/**
 * What a new environment declares regenerable before anyone edits it.
 *
 * The sandbox runtime keeps these out of the snapshot layer and therefore out
 * of the quota: they are rebuilt from the specification, so charging a
 * multi-gigabyte `node_modules` against an allowance sized for source would
 * make the allowance unusable for the projects it is sold for.
 *
 * A default rather than a built-in rule, because the field is a PROMISE by the
 * environment's author that the path can be rebuilt — and a promise the
 * platform makes silently is one the author cannot withdraw. Seeded into the
 * form at creation, visible, and removable.
 */
export const DEFAULT_REGENERABLE_PATHS = ['node_modules', '.venv', 'target'] as const;

/**
 * A definition as the execution plane receives it: without the fields that are
 * only the product's own ({@link EnvironmentConfiguration.kind} and
 * {@link EnvironmentConfiguration.notes}). The
 * execution plane digests what it is sent to decide which build a snapshot
 * belongs to, so a presentation field passed through would mark every
 * existing instance as built from a different specification.
 */
export const toExecutionConfiguration = (
  configuration: EnvironmentConfiguration,
): EnvironmentConfiguration => {
  const { kind: _kind, notes: _notes, ...rest } = withRepositorySetup(configuration);

  return rest.sources ? { ...rest, sources: layoutRepositorySources(rest.sources) } : rest;
};

/** The last segment of a checkout url — the repository's name, without `.git`. */
export const repositoryFolderName = (url: string): string =>
  url
    .replace(/\.git$/, '')
    .replace(/\/+$/, '')
    .split('/')
    .pop() || 'repository';

/** `owner-name` of a checkout url, the fallback when two repositories share a name. */
const repositoryOwnerFolderName = (url: string): string => {
  const [owner, name] = url
    .replace(/\.git$/, '')
    .replace(/\/+$/, '')
    .split('/')
    .slice(-2);
  return owner && name ? `${owner}-${name}` : repositoryFolderName(url);
};

const isRootPath = (path: string | undefined) => {
  const value =
    path
      ?.trim()
      .replace(/^\.?\/+/, '')
      .replace(/\/+$/, '') ?? '';
  return value === '' || value === '.';
};

/**
 * Where each repository of an environment is checked out.
 *
 * One repository is checked out at the top of the working directory, as it
 * always was. Several are laid out side by side, each in a folder of its own
 * named after it (`lobehub/`, `lobe-ui/`), and the working directory itself is
 * none of them. Nesting one checkout inside another would put the second
 * repository in the first one's working tree — untracked in its `git status`,
 * one `git add -A` away from being committed into it as an embedded repository,
 * and inside every search, lint and build the first one runs.
 *
 * A folder the author set explicitly is kept; only a repository left at the
 * top gets one. Two repositories of the same name fall back to `owner-name`,
 * then a numeric suffix.
 */
export const layoutRepositorySources = (sources: EnvironmentSource[]): EnvironmentSource[] => {
  const repositories = sources.filter((source) => source.kind === 'git');
  if (repositories.length <= 1) return sources;

  const taken = new Set(
    repositories.flatMap((source) =>
      isRootPath(source.path)
        ? []
        : [
            source
              .path!.trim()
              .replace(/^\.?\/+/, '')
              .replace(/\/+$/, ''),
          ],
    ),
  );
  const claim = (url: string) => {
    let folder = repositoryFolderName(url);
    if (taken.has(folder)) folder = repositoryOwnerFolderName(url);
    for (let suffix = 2; taken.has(folder); suffix++)
      folder = `${repositoryOwnerFolderName(url)}-${suffix}`;
    taken.add(folder);
    return folder;
  };

  return sources.map((source) =>
    source.kind === 'git' && isRootPath(source.path)
      ? { ...source, path: claim(source.url) }
      : source,
  );
};

const shellQuote = (value: string): string => `'${value.replaceAll("'", String.raw`'\''`)}'`;

/**
 * The definition with each repository's own setup folded into the one setup
 * command the execution plane runs, and taken off the sources.
 *
 * Every repository's setup runs in its own folder, in the order the
 * repositories are checked out, each in a subshell so a `cd` in one does not
 * move the next; then the environment's own setup at the top of the working
 * directory. Chained with `&&`: the first failure stops the rest, as one
 * command failing always did.
 *
 * A definition without any repository setup comes back as it was, so the
 * digest of every build made before repositories had one is unchanged.
 */
export const withRepositorySetup = (
  configuration: EnvironmentConfiguration,
): EnvironmentConfiguration => {
  const sources = configuration.sources ?? [];
  const hasRepositorySetup = sources.some(
    (source) => source.kind === 'git' && source.setupCommand?.trim(),
  );
  if (!hasRepositorySetup) return configuration;

  const steps = layoutRepositorySources(sources).flatMap((source) => {
    const command = source.kind === 'git' ? source.setupCommand?.trim() : undefined;
    if (!command) return [];
    const folder = isRootPath(source.path) ? '.' : source.path!.trim();
    return [`(cd ${shellQuote(folder)} && ${command}\n)`];
  });
  const own = configuration.bootstrapCommand?.trim();

  return {
    ...configuration,
    bootstrapCommand: [...steps, ...(own ? [`(${own}\n)`] : [])].join(' && '),
    sources: sources.map((source) => {
      if (source.kind !== 'git' || source.setupCommand === undefined) return source;
      const { setupCommand: _setupCommand, ...rest } = source;
      return rest;
    }),
  };
};
