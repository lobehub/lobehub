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
  | { kind: 'git'; path?: string; ref?: string; url: string }
  | { kind: 'files'; path?: string; uri: string };

export interface EnvironmentResourceRequirements {
  cpu?: number;
  gpu?: { count: number; memoryGiB?: number; model?: string };
  memoryGiB?: number;
}

/**
 * What an environment is for, as the person who made it chose it.
 *
 * `files` is a folder someone hands files to for an agent to work on; `code`
 * checks out a repository and runs setup. Presentation only: it decides which
 * form and which entries the product shows, and never reaches the execution
 * plane — see {@link environmentKind} for how an environment without one reads.
 */
export type EnvironmentKind = 'files' | 'code';

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
   * Chosen at creation; absent on environments made before there was a
   * choice, which {@link environmentKind} reads from what they configure.
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
  /** Requirements, not a selection of a particular machine or provider. */
  requirements?: EnvironmentResourceRequirements;
  sources?: EnvironmentSource[];
}

/** Remote hosts connected through lh are devices too. Clusters are controlled through rc. */
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
 * The kind an environment reads as.
 *
 * The stored choice when there is one. An environment made before the choice
 * existed is not backfilled; it is read from what it configures instead — a
 * repository or a setup command is code work, and anything else is a folder of
 * files.
 */
export const environmentKind = (
  environment:
    | {
        configuration?: Pick<
          EnvironmentConfiguration,
          'bootstrapCommand' | 'kind' | 'sources'
        > | null;
      }
    | null
    | undefined,
): EnvironmentKind => {
  const configuration = environment?.configuration;
  if (configuration?.kind === 'files' || configuration?.kind === 'code') return configuration.kind;

  return (configuration?.sources?.length ?? 0) > 0 ||
    Boolean(configuration?.bootstrapCommand?.trim())
    ? 'code'
    : 'files';
};

/**
 * A definition as the execution plane receives it: without the fields that are
 * only the product's own (today, {@link EnvironmentConfiguration.kind}). The
 * execution plane digests what it is sent to decide which build a snapshot
 * belongs to, so a presentation field passed through would mark every
 * existing instance as built from a different specification.
 */
export const toExecutionConfiguration = (
  configuration: EnvironmentConfiguration,
): EnvironmentConfiguration => {
  const { kind: _kind, ...rest } = configuration;

  return rest;
};
