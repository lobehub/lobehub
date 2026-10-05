import type { EnvironmentConfiguration, EnvironmentInstanceConfiguration } from '@lobechat/types';
import { and, asc, eq, getTableColumns, inArray, isNull, or, sql } from 'drizzle-orm';

import type { EnvironmentInstanceItem, NewEnvironmentInstance } from '../schemas';
import { environmentInstances, environments } from '../schemas';
import type { LobeChatDatabase } from '../type';
import { environmentOwnership, environmentVisibility } from './environment';

/** The binding that says which machine, account or volume an instance lives in. */
export type EnvironmentInstanceBinding = Pick<
  NewEnvironmentInstance,
  'kind' | 'deviceId' | 'provider' | 'providerScope' | 'providerResourceId'
>;

export interface CreateEnvironmentInstanceParams extends EnvironmentInstanceBinding {
  configuration?: EnvironmentInstanceConfiguration;
  environmentId: string;
  name: string;
  workingDirectory: string;
}

/**
 * A materialization of an environment: one instance, in one place, with one
 * directory. Two of them off the same specification is the supported way to run
 * two conversations side by side — each keeps its own files and its own
 * captured state, where a shared directory would have them overwrite each
 * other's work.
 *
 * `configurationSnapshot` is the specification as it stood when this instance
 * was built, deliberately not refreshed on its own. It is what makes the built
 * state a cache rather than the only record: when it no longer matches the
 * environment's `configuration`, this instance is out of date and can be
 * rebuilt from the specification instead of being repaired by hand.
 *
 * Ownership is inherited, not stored — there is no owner column here, so every
 * statement reaches through the environment. That is load-bearing rather than
 * incidental: an instance's captured state includes a home directory, and a
 * home directory holds credentials.
 *
 * Which is why the two directions differ. READS follow the environment's
 * visibility, so a member can run in an environment a colleague published —
 * that is what publishing one means. WRITES stay with the creator: using a
 * shared environment must not let anyone reshape it, add copies to it, or
 * delete the copies other people are working in.
 */
/**
 * A new instance's directory would sit inside another instance's, or contain
 * one. Two instances on overlapping trees restore their captured state over
 * each other's files, which is the mixing separate instances exist to prevent —
 * the unique index only catches the identical path.
 */
export class InstanceDirectoryOverlapError extends Error {
  constructor(readonly workingDirectory: string) {
    super('OVERLAPPING_INSTANCE_DIRECTORY');
    this.name = 'InstanceDirectoryOverlapError';
  }
}

export class EnvironmentInstanceModel {
  private db: LobeChatDatabase;
  private userId: string;
  private workspaceId?: string;
  /** See {@link environmentVisibility}: a public agent reads published environments only. */
  private callerAgentVisibility?: 'private' | 'public' | null;

  constructor(
    db: LobeChatDatabase,
    userId: string,
    workspaceId?: string,
    callerAgentVisibility?: 'private' | 'public' | null,
  ) {
    this.db = db;
    this.userId = userId;
    this.workspaceId = workspaceId;
    this.callerAgentVisibility = callerAgentVisibility;
  }

  /** Environments this member owns, as a subquery the write statements filter through. */
  private ownedEnvironments = () =>
    this.db
      .select({ id: environments.id })
      .from(environments)
      .where(environmentOwnership(this.userId, this.workspaceId));

  /** Environments this member may see — their own, plus the workspace's published ones. */
  private visibleEnvironments = () =>
    this.db
      .select({ id: environments.id })
      .from(environments)
      .where(environmentVisibility(this.userId, this.workspaceId, this.callerAgentVisibility));

  private ownership = () => inArray(environmentInstances.environmentId, this.ownedEnvironments());

  private visible = () => inArray(environmentInstances.environmentId, this.visibleEnvironments());

  /**
   * Every instance the caller can see. Each carries the specification as it
   * stood when it was created (`configurationSnapshot`); editing the
   * environment afterwards changes what NEW instances are built from and
   * leaves existing ones exactly as they are.
   */
  query = async (params: { environmentId?: string } = {}): Promise<EnvironmentInstanceItem[]> =>
    this.db
      .select(getTableColumns(environmentInstances))
      .from(environmentInstances)
      .innerJoin(environments, eq(environments.id, environmentInstances.environmentId))
      .where(
        and(
          environmentVisibility(this.userId, this.workspaceId, this.callerAgentVisibility),
          params.environmentId
            ? eq(environmentInstances.environmentId, params.environmentId)
            : undefined,
        ),
      )
      .orderBy(asc(environmentInstances.createdAt));

  /** Readable: this is what a run resolves through, including in a published environment. */
  findById = async (id: string): Promise<EnvironmentInstanceItem | undefined> => {
    const [row] = await this.db
      .select()
      .from(environmentInstances)
      .where(and(eq(environmentInstances.id, id), this.visible()))
      .limit(1);

    return row;
  };

  /**
   * The same row, but only when the caller owns the environment behind it.
   *
   * Every destructive path looks the instance up through this rather than
   * {@link findById}, because those paths act on the execution plane BEFORE
   * they touch the row: a member of a published environment who could pass the
   * read check would delete the snapshot and only then be refused the row,
   * leaving captured state nobody can name.
   */
  findOwnedById = async (id: string): Promise<EnvironmentInstanceItem | undefined> => {
    const [row] = await this.db
      .select()
      .from(environmentInstances)
      .where(and(eq(environmentInstances.id, id), this.ownership()))
      .limit(1);

    return row;
  };

  /**
   * The instance that already occupies this directory, if any. One instance
   * per directory is a database constraint, so this is how a caller that only
   * knows where it wants to work finds out whether that is a new copy or an
   * existing one.
   */
  findByWorkingDirectory = async (
    workingDirectory: string,
  ): Promise<EnvironmentInstanceItem | undefined> => {
    const [row] = await this.db
      .select()
      .from(environmentInstances)
      .where(and(eq(environmentInstances.workingDirectory, workingDirectory), this.visible()))
      .limit(1);

    return row;
  };

  /**
   * One device's instance at a path, by the pair the schema makes unique.
   *
   * Unlike {@link findByWorkingDirectory} this does not filter by what the
   * caller can see: it answers inside `ProjectDirectoryRepository.bind`, which
   * has already resolved the device through the caller's own scope, and a
   * second filter there would only hide a row whose directory is about to be
   * bound anyway — turning "already bound" into a duplicate insert.
   */
  findByDeviceAndDirectory = async (
    deviceId: string,
    workingDirectory: string,
  ): Promise<EnvironmentInstanceItem | undefined> => {
    const [row] = await this.db
      .select()
      .from(environmentInstances)
      .where(
        and(
          eq(environmentInstances.deviceId, deviceId),
          eq(environmentInstances.workingDirectory, workingDirectory),
        ),
      );
    return row;
  };

  /**
   * The insert `bind` makes, once it has decided there is one to make.
   *
   * Deliberately thinner than {@link create}: ownership of the environment and
   * of the device are both settled by the caller, inside the transaction that
   * locked the device row, so repeating those reads here would re-ask a
   * question already answered under a weaker lock.
   */
  createForDeviceBinding = async (input: {
    configurationSnapshot: EnvironmentConfiguration;
    deviceId: string;
    environmentId: string;
    name: string;
    workingDirectory: string;
  }): Promise<EnvironmentInstanceItem> => {
    const [row] = await this.db
      .insert(environmentInstances)
      .values({ ...input, kind: 'device' })
      .returning();
    return row;
  };

  /**
   * Returns `undefined` when the environment is not this member's, which is the
   * same answer as "no such environment" on purpose: the caller has no business
   * learning that an id it cannot use exists.
   */
  create = async (
    params: CreateEnvironmentInstanceParams,
  ): Promise<EnvironmentInstanceItem | undefined> => {
    const { configuration, environmentId, name, workingDirectory, ...binding } = params;

    const [environment] = await this.db
      .select()
      .from(environments)
      .where(
        and(
          eq(environments.id, environmentId),
          environmentOwnership(this.userId, this.workspaceId),
        ),
      )
      .limit(1);

    if (!environment) return undefined;

    const bindingScope = binding.deviceId
      ? eq(environmentInstances.deviceId, binding.deviceId)
      : and(
          isNull(environmentInstances.deviceId),
          eq(environmentInstances.provider, binding.provider ?? ''),
          eq(environmentInstances.providerScope, binding.providerScope ?? ''),
          eq(environmentInstances.providerResourceId, binding.providerResourceId ?? ''),
        );

    // The unique index covers exact duplicates only, so `foo` and `foo/bar`
    // are rejected by the query below rather than by a constraint — which
    // makes this a read before a write, and two concurrent creations would
    // otherwise both pass it and end up sharing a worktree. Serialize the
    // pair on the storage they are competing for.
    const lockKey = `environment_instance_dir:${binding.kind}:${
      binding.deviceId ??
      `${binding.provider ?? ''}/${binding.providerScope ?? ''}/${binding.providerResourceId ?? ''}`
    }`;

    return this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`);

      // Across every instance on the same storage, not only the ones this
      // member can see: a colleague's private instance occupies its directory
      // just the same. Only whether one overlaps is read, never which.
      const [overlapping] = await tx
        .select({ id: environmentInstances.id })
        .from(environmentInstances)
        .where(
          and(
            eq(environmentInstances.kind, binding.kind),
            bindingScope,
            or(
              sql`starts_with(${environmentInstances.workingDirectory}, ${`${workingDirectory}/`})`,
              sql`starts_with(${workingDirectory}, ${environmentInstances.workingDirectory} || '/')`,
            ),
          ),
        )
        .limit(1);

      if (overlapping) throw new InstanceDirectoryOverlapError(workingDirectory);

      const [row] = await tx
        .insert(environmentInstances)
        .values({
          ...binding,
          configuration,
          // Taken here rather than read through the environment at use time:
          // this is the definition this instance was actually built from, and
          // keeping it is what lets a later comparison say "the specification
          // moved".
          configurationSnapshot: environment.configuration,
          environmentId,
          name,
          workingDirectory,
        })
        .returning();

      return row;
    });
  };

  /**
   * Writes the verdict the execution plane returned for one build.
   *
   * Scoped by {@link visible} rather than ownership on purpose: a member
   * watching a published environment build can be the one whose poll receives
   * the terminal status, and an ownership-scoped write would silently drop it
   * and leave the owner's row `pending` against a build the runtime has since
   * discarded. The verdict is the runtime's, not the caller's, so recording it
   * is not a user edit — and `buildId` must still match, so a late reply from
   * a superseded build cannot overwrite a newer one.
   */
  recordBuildResult = async (
    id: string,
    buildId: string,
    params: Pick<NewEnvironmentInstance, 'buildError' | 'status'>,
  ): Promise<void> => {
    await this.db
      .update(environmentInstances)
      .set({ ...params, buildId: null, updatedAt: new Date() })
      .where(
        and(
          eq(environmentInstances.id, id),
          eq(environmentInstances.buildId, buildId),
          this.visible(),
        ),
      );
  };

  update = async (
    id: string,
    params: Partial<
      Pick<
        NewEnvironmentInstance,
        'buildError' | 'buildId' | 'configuration' | 'enabled' | 'name' | 'status'
      >
    >,
  ): Promise<EnvironmentInstanceItem | undefined> => {
    const [row] = await this.db
      .update(environmentInstances)
      .set({ ...params, updatedAt: new Date() })
      .where(and(eq(environmentInstances.id, id), this.ownership()))
      .returning();

    return row;
  };

  /**
   * Removes only the row. Whatever the execution plane built belongs to it, and
   * the caller deletes it there first — dropping this row while the built state
   * lives on would leave storage nobody can name, and therefore nobody can
   * reclaim.
   */
  delete = async (id: string): Promise<EnvironmentInstanceItem | undefined> => {
    const [row] = await this.db
      .delete(environmentInstances)
      .where(and(eq(environmentInstances.id, id), this.ownership()))
      .returning();

    return row;
  };
}
