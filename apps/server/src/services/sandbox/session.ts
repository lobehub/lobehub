import {
  DEFAULT_SANDBOX_DRIVE,
  DEFAULT_SANDBOX_MODE,
  isSafeSandboxCwd,
  isSafeSandboxEnvironmentId,
  SANDBOX_DRIVE_ROOT,
  SANDBOX_LOCAL_WORK_ROOT,
  type SandboxDrive,
  sandboxDriveOfKey,
  type SandboxMode,
  type SandboxStorageClaim,
} from '@lobechat/builtin-tool-cloud-sandbox';
import type { LobeChatDatabase } from '@lobechat/database';
import type { EnvironmentConfiguration } from '@lobechat/types';
import debug from 'debug';

import { AgentModel } from '@/database/models/agent';
import { EnvironmentModel } from '@/database/models/environment';
import { EnvironmentInstanceModel } from '@/database/models/environmentInstance';
import { TopicModel } from '@/database/models/topic';
import { resolveScmCloneCredential } from '@/server/services/scm/cloneCredential';

import { sandboxStorageBinding } from './binding';
import { driveFolderExists } from './driveFolder';
import { resolveSandboxStorageClaim } from './entitlement';
import { type SandboxInitialization, toSandboxInitialization } from './environmentInit';
import type { SandboxSessionSpecification } from './types';

const log = debug('lobe-server:sandbox:session');

export type SandboxPlacementFallback =
  'directoryMissing' | 'instanceRebuildRequired' | 'instanceUnavailable' | 'rootNotAllowed';

export interface SandboxSessionConfig {
  /**
   * The signed entitlement, or `null` when this run gets no persistent
   * workspace. Independent of {@link mode}: the workspace exists whether or not
   * THIS topic writes to it, and the file browser reads it from an ephemeral
   * topic just as well.
   */
  claim: SandboxStorageClaim | null;
  /**
   * The folder the run works in, relative to the drive's root: the chosen
   * folder of a `drive` run, or an instance's directory. Absent on a drive run
   * at the root, and on every ephemeral one.
   */
  cwd?: string;
  /**
   * Which of the workspace's drives {@link claim} names; always `personal` in
   * a personal account, which has only the one.
   */
  drive: SandboxDrive;
  /**
   * Snapshot to restore, or `undefined` for the caller's default. This is the
   * INSTANCE's id, not the environment's: what was installed belongs to one
   * instance, so two instances of one environment restore separately and
   * capture separately.
   *
   * Carries the same invariant as {@link SandboxSessionConfig.mode}: a session
   * is bound to one of these on its first call, so every call for a topic has
   * to agree or the snapshot at the end is refused.
   */
  environment?: string;
  /**
   * Why a placement the topic chose was not honoured, when the run fell back
   * to a temporary sandbox because of it. Set only on that fallback, so the
   * composer can say what happened instead of quietly running somewhere the
   * person did not pick:
   *
   * - `directoryMissing` — the folder is no longer on the drive;
   * - `instanceUnavailable` — the environment directory was deleted, is not
   *   this member's to use, or the folder sits inside one;
   * - `instanceRebuildRequired` — a private environment's directory left on
   *   the workspace's public drive from before members had drives of their
   *   own; it stays hidden there, and the environment has to be initialized
   *   again on the owner's personal drive;
   * - `rootNotAllowed` — the public drive's root, which every member's
   *   folders live under, is not a folder anyone may work in.
   */
  fallback?: SandboxPlacementFallback;
  /**
   * The environment to initialize the working directory from, when the topic
   * picked one: applied once to a folder on the drive, and once per sandbox in
   * a temporary one. Never set on a legacy instance run — its build did this.
   */
  initialization?: SandboxInitialization;
  mode: SandboxMode;
  /**
   * What the instance was built from, for the execution plane to act on while
   * the session runs. Absent on an ephemeral run, which has no instance and
   * therefore no definition to honour.
   *
   * The instance's own snapshot of the definition, not the environment's
   * current one — the same object its build used. So the variables a command
   * sees are the ones its packages were installed under, and the digest the
   * execution plane records for a session matches the digest of the build it
   * restored. Editing the environment therefore takes effect on rebuild, which
   * is the same rule the checkout and the installed packages already follow.
   */
  specification?: SandboxSessionSpecification;
  /**
   * Where commands run, when that is not {@link cwd}: the sandbox's local
   * disk, for an instance that has been built from a repository. The checkout
   * lives there and installs only work there; {@link cwd} stays the
   * instance's directory on the volume, which is what the call belongs to —
   * what a shared workspace narrows its view to, and what the file browser
   * reads.
   */
  workingDir?: string;
}

/**
 * The run-time half of a stored definition, named field by field.
 *
 * Everything this omits is either not the execution plane's business during a
 * session or has no business leaving the server at all; see
 * {@link SandboxSessionSpecification}. Absent when the pick is empty, so a
 * definition that says nothing sends nothing rather than an empty object the
 * runtime would still adopt.
 *
 * `kind` is the clearest case of the first: it only picks which form the
 * product shows, and an execution plane that saw it would digest it into every
 * session of every environment that gained one.
 */
const toSessionSpecification = (
  configuration: EnvironmentConfiguration | null | undefined,
): SandboxSessionSpecification | undefined => {
  if (!configuration) return undefined;

  const specification: SandboxSessionSpecification = {
    ...(configuration.bootstrapCommand && { bootstrapCommand: configuration.bootstrapCommand }),
    ...(configuration.env &&
      Object.keys(configuration.env).length > 0 && { env: configuration.env }),
    ...(configuration.excludePaths?.length && { excludePaths: configuration.excludePaths }),
    ...(configuration.internetAccess !== undefined && {
      internetAccess: configuration.internetAccess,
    }),
    ...(configuration.maintenanceCommand && {
      maintenanceCommand: configuration.maintenanceCommand,
    }),
    ...(configuration.sources?.length && { sources: configuration.sources }),
  };

  return Object.keys(specification).length > 0 ? specification : undefined;
};

/**
 * Whether an instance's checkout is on the sandbox's local disk: it has been
 * built, from a definition that clones something. An instance with nothing to
 * clone has no checkout to run in, and one not built yet has nothing there.
 */
const hasLocalCheckout = (instance: {
  configurationSnapshot?: { sources?: { kind?: string }[] } | null;
  status?: string | null;
}): boolean =>
  instance.status === 'ready' &&
  !!instance.configurationSnapshot?.sources?.some((source) => source.kind === 'git');

interface SandboxSessionConfigInput {
  /** See `resolveSandboxStorageClaim` — a visitor run never gets an entitlement. */
  isShareVisitorRun: boolean;
  /**
   * Optional because some runtimes are constructed without one. No database
   * means no plan and no preferences to read, which is exactly the shape of
   * "not entitled" — so the run stays ephemeral rather than half-configured.
   */
  serverDB?: LobeChatDatabase;
  topicId?: string;
  userId: string;
  workspaceId?: string | null;
}

/**
 * Everything the sandbox layer needs to know about persistence for one run,
 * resolved once: the entitlement that goes on the trust token, and the topic's
 * own placement that goes on each request. One of three:
 *
 * - **instance** (`persistent`) — the topic is bound to an environment
 *   directory: its folder plus the packages its build installed;
 * - **drive** — the topic picked a folder on the drive (or its root, in a
 *   personal account): the folder persists, nothing else does;
 * - **temporary** (`ephemeral`) — nothing picked, or a pick that can no
 *   longer be honoured, which then says why in `fallback`.
 *
 * The topic is read first because it names the drive, and the drive names the
 * claim's key: a workspace has a public drive and one personal drive per
 * member, and a run is issued a claim for exactly one of them. Without an
 * entitlement the execution plane routes to the ephemeral sandbox whatever the
 * request says, and the placement is left untouched on the topic — which is
 * what lets a lapsed subscription pick up exactly where it left off.
 *
 * Never throws; a failed lookup degrades to the ephemeral sandbox every session
 * uses today.
 */
const resolvePlacement = async ({
  isShareVisitorRun,
  serverDB,
  topicId,
  userId,
  workspaceId,
}: SandboxSessionConfigInput): Promise<SandboxSessionConfig> => {
  // A personal account has one drive, its own; a workspace run starts on the
  // public one until the topic says otherwise.
  const defaultDrive: SandboxDrive = workspaceId ? DEFAULT_SANDBOX_DRIVE : 'personal';
  if (!serverDB) return { claim: null, drive: defaultDrive, mode: DEFAULT_SANDBOX_MODE };

  // One claim per drive, and each is resolved at most once: the topic decides
  // which drive the run addresses, and a run only ever addresses one.
  const claimFor = (drive: SandboxDrive) =>
    resolveSandboxStorageClaim({ drive, isShareVisitorRun, serverDB, userId, workspaceId });

  if (!topicId) {
    const claim = await claimFor(defaultDrive);
    log(
      'Ephemeral without a topic: claim=%s userId=%s workspaceId=%s',
      !!claim,
      userId,
      workspaceId,
    );

    return { claim, drive: defaultDrive, mode: DEFAULT_SANDBOX_MODE };
  }

  let drive = defaultDrive;
  let claim: SandboxStorageClaim | null = null;
  const fallBack = (fallback: SandboxPlacementFallback): SandboxSessionConfig => ({
    claim,
    drive,
    fallback,
    mode: DEFAULT_SANDBOX_MODE,
  });

  try {
    // Scoped to the workspace the run is in: without it the model reads the
    // personal scope (`workspace_id IS NULL`), a workspace topic never
    // resolves, and every workspace run silently loses its placement.
    const topic = await new TopicModel(serverDB, userId, workspaceId ?? undefined).findById(
      topicId,
    );
    const instanceId = topic?.metadata?.sandboxInstanceId;
    const folder = topic?.metadata?.sandboxWorkingDirectory;
    if (workspaceId && topic?.metadata?.sandboxDrive === 'personal') drive = 'personal';

    if (instanceId) {
      // A workspace-public agent runs on its caller's session, and a private
      // environment's captured state can hold that caller's credentials — so
      // a shared agent reads published environments only. Personal mode has
      // no such boundary: its agents default to 'public' without meaning it.
      const callerAgentVisibility =
        workspaceId && topic.agentId
          ? await new AgentModel(serverDB, userId, workspaceId).getAgentVisibility(topic.agentId)
          : null;

      const instance = await new EnvironmentInstanceModel(
        serverDB,
        userId,
        workspaceId ?? undefined,
        callerAgentVisibility,
      ).findById(instanceId);

      // The instance lives on one drive and the run goes there, whatever the
      // topic's drive field says: the directory and its snapshot are on that
      // drive's volume and nowhere else. A drive that is not the caller's —
      // another member's personal one — is not a drive the caller can be
      // issued a claim for.
      const instanceDrive = instance
        ? sandboxDriveOfKey(instance.providerScope ?? '', { userId, workspaceId })
        : undefined;
      if (instanceDrive) drive = instanceDrive;
      claim = await claimFor(drive);
      if (!claim) return { claim, drive, mode: DEFAULT_SANDBOX_MODE };

      // Deleted, never this member's, or private under a public agent. Any
      // way, the conversation still runs — in a temporary sandbox, and the
      // composer names why — rather than not at all until someone edits a
      // database row.
      if (!instance || !instanceDrive) {
        log(
          'Ignoring unresolvable sandboxInstanceId on topic %s: %o (agentId=%o visibility=%o scope user=%s workspace=%s)',
          topicId,
          instanceId,
          topic.agentId,
          callerAgentVisibility,
          userId,
          workspaceId,
        );

        return fallBack('instanceUnavailable');
      }

      // A private environment's directory on the public drive predates
      // personal drives. Its home directory can hold its owner's credentials,
      // and every member can reach the public drive, so it is not run in —
      // the owner initializes the environment again on their personal drive.
      if (instanceDrive === 'public' && workspaceId) {
        const directories = await new EnvironmentInstanceModel(
          serverDB,
          userId,
          workspaceId,
        ).listStorageDirectories(sandboxStorageBinding(claim.key));
        if (directories.some((entry) => entry.id === instance.id && entry.isPrivate)) {
          log('Private instance %s on the public drive needs a rebuild', instance.id);
          return fallBack('instanceRebuildRequired');
        }
      }

      // The directory and the snapshot are one choice, so a bad half discards
      // the whole instance rather than half of it. Running the instance's
      // packages at the drive root would put one instance's files under
      // another's captured state, which is the exact mixing separate instances
      // exist to prevent — and it would do it silently.
      const { id, workingDirectory } = instance;
      if (!isSafeSandboxCwd(workingDirectory) || !isSafeSandboxEnvironmentId(id)) {
        log('Ignoring unusable instance %s on topic %s: %o', id, topicId, workingDirectory);
        return fallBack('instanceUnavailable');
      }

      log(
        'Persistent for topic %s: instance=%s cwd=%o drive=%s',
        topicId,
        id,
        workingDirectory,
        drive,
      );

      const specification = toSessionSpecification(instance.configurationSnapshot);

      return {
        claim,
        cwd: workingDirectory,
        drive,
        environment: id,
        mode: 'persistent',
        ...(specification && { specification }),
        ...(hasLocalCheckout(instance) && { workingDir: SANDBOX_LOCAL_WORK_ROOT }),
      };
    }

    // The topic is only consulted when an entitlement exists. Without one the
    // execution plane routes to the ephemeral sandbox whatever the request
    // says, and leaving the choice untouched on the topic is what lets a
    // lapsed subscription pick up exactly where it left off.
    claim = await claimFor(drive);
    if (!claim) {
      log('Ephemeral for topic %s: no claim for drive %s', topicId, drive);
      return { claim, drive, mode: DEFAULT_SANDBOX_MODE };
    }

    if (folder === undefined) {
      log('Ephemeral for topic %s: no folder picked', topicId);
      return { claim, drive, mode: DEFAULT_SANDBOX_MODE };
    }

    if (folder === SANDBOX_DRIVE_ROOT) {
      // A personal drive is its owner's alone, so its root is a folder like
      // any other. The public one holds every member's folders, and a session
      // there is narrowed to the one it picked — the root narrows nothing.
      if (workspaceId && drive === 'public') return fallBack('rootNotAllowed');

      log('Drive for topic %s at the root of %s', topicId, claim.key);
      return { claim, drive, mode: 'drive' };
    }

    if (!isSafeSandboxCwd(folder)) return fallBack('directoryMissing');

    // Deleted since it was picked — by this member in another tab, or by a
    // colleague on the public drive. Recreating it silently would bring back
    // an empty folder under a name someone chose to remove.
    if ((await driveFolderExists({ claim, path: folder, userId, workspaceId })) === false) {
      log('Folder %o on topic %s is no longer on the drive', folder, topicId);
      return fallBack('directoryMissing');
    }

    log('Drive for topic %s: cwd=%o drive=%s', topicId, folder, drive);
    return { claim, cwd: folder, drive, mode: 'drive' };
  } catch (error) {
    log('Failed to read sandbox preferences for topic %s: %O', topicId, error);
    return { claim: claim ?? (await claimFor(drive)), drive, mode: DEFAULT_SANDBOX_MODE };
  }
};

/**
 * The topic's environment as an initialization, or `undefined` when it picked
 * none, picked one the caller cannot read (deleted, or another member's
 * private one), or one that asks for nothing.
 */
const resolveInitialization = async ({
  serverDB,
  topicId,
  userId,
  workspaceId,
}: Required<Pick<SandboxSessionConfigInput, 'serverDB' | 'topicId'>> &
  Pick<SandboxSessionConfigInput, 'userId' | 'workspaceId'>): Promise<
  SandboxInitialization | undefined
> => {
  try {
    const topic = await new TopicModel(serverDB, userId, workspaceId ?? undefined).findById(
      topicId,
    );
    const environmentId = topic?.metadata?.sandboxEnvironmentId;
    if (!environmentId) return undefined;

    const environment = await new EnvironmentModel(
      serverDB,
      userId,
      workspaceId ?? undefined,
    ).findById(environmentId);
    if (!environment) {
      log('Ignoring unreadable sandboxEnvironmentId on topic %s: %s', topicId, environmentId);
      return undefined;
    }

    // The same boundary legacy instances keep: a workspace-public agent runs
    // on its caller's session, and a private environment's variables, setup
    // and checkout are that caller's — so a shared agent applies published
    // environments only.
    if (workspaceId && topic.agentId && environment.visibility !== 'public') {
      const agentVisibility = await new AgentModel(
        serverDB,
        userId,
        workspaceId,
      ).getAgentVisibility(topic.agentId);
      if (agentVisibility === 'public') {
        log(
          'Not applying private environment %s for shared agent %s',
          environmentId,
          topic.agentId,
        );
        return undefined;
      }
    }

    const initialization = toSandboxInitialization(environment);
    if (!initialization || initialization.sources.length === 0) return initialization;

    // The same credential a build used to get, so a private repository the
    // picker offered still clones. Never throws: without one, a public
    // repository clones and a private one fails in the report, by name.
    const cloneCredential = await resolveScmCloneCredential({
      configuration: environment.configuration ?? undefined,
      db: serverDB,
      userId,
      workspaceId,
    });

    return cloneCredential ? { ...initialization, cloneCredential } : initialization;
  } catch (error) {
    log('Failed to read the environment for topic %s: %O', topicId, error);
    return undefined;
  }
};

/**
 * Everything the sandbox layer needs to know about one run: where it works
 * ({@link resolvePlacement}) and, when the topic picked an environment, what
 * that working directory is initialized from. The environment is independent
 * of the placement — a temporary sandbox is initialized as readily as a folder
 * — except on a legacy instance run, which already has what its build made.
 *
 * Never throws; a failed lookup degrades to the ephemeral sandbox every session
 * uses today, without an environment.
 */
export const resolveSandboxSessionConfig = async (
  input: SandboxSessionConfigInput,
): Promise<SandboxSessionConfig> => {
  const config = await resolvePlacement(input);
  const { serverDB, topicId } = input;
  if (!serverDB || !topicId || config.mode === 'persistent') return config;

  const initialization = await resolveInitialization({ ...input, serverDB, topicId });

  return initialization ? { ...config, initialization } : config;
};
