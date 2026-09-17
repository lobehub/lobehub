import type { EnvironmentInstanceConfiguration } from '@lobechat/types';
import { and, asc, eq, getTableColumns, inArray, sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

import type { EnvironmentInstanceItem, NewEnvironmentInstance } from '../schemas';
import { environmentInstances, environments } from '../schemas';
import type { LobeChatDatabase } from '../type';
import { environmentOwnership } from './environment';

/**
 * The part of a specification a build actually depends on, projected so two
 * configurations that differ only in how a session runs compare equal.
 */
const buildInputs = (column: AnyPgColumn) =>
  sql`jsonb_build_object('bootstrapCommand', ${column} -> 'bootstrapCommand', 'env', ${column} -> 'env', 'sources', ${column} -> 'sources')`;

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
 * A materialization of an environment: one working copy, in one place, with one
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
 */
export class EnvironmentInstanceModel {
  private db: LobeChatDatabase;
  private userId: string;
  private workspaceId?: string;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.db = db;
    this.userId = userId;
    this.workspaceId = workspaceId;
  }

  /** Environments this member owns, as a subquery the instance statements filter through. */
  private ownedEnvironments = () =>
    this.db
      .select({ id: environments.id })
      .from(environments)
      .where(environmentOwnership(this.userId, this.workspaceId));

  private ownership = () => inArray(environmentInstances.environmentId, this.ownedEnvironments());

  /**
   * Instances with the one thing that cannot be read off the row: whether this
   * copy needs rebuilding.
   *
   * Only the fields that change what gets BUILT count — the sources to check
   * out, the command that makes them usable, and the variables that command
   * runs under. `internetAccess` and `requirements` are deliberately excluded:
   * they change how a session runs, not what a build produces, and folding them
   * in would throw away a multi-gigabyte dependency cache because somebody
   * moved a memory slider.
   *
   * Compared in SQL rather than in JS because `jsonb` equality ignores key
   * order and duplicate keys, while two objects that serialize differently in
   * JavaScript may describe exactly the same environment — a comparison done up
   * here would report half the fleet stale after a harmless re-save.
   */
  query = async (
    params: { environmentId?: string } = {},
  ): Promise<(EnvironmentInstanceItem & { stale: boolean })[]> =>
    this.db
      .select({
        ...getTableColumns(environmentInstances),
        stale: sql<boolean>`${buildInputs(environments.configuration)} IS DISTINCT FROM ${buildInputs(environmentInstances.configurationSnapshot)}`,
      })
      .from(environmentInstances)
      .innerJoin(environments, eq(environments.id, environmentInstances.environmentId))
      .where(
        and(
          environmentOwnership(this.userId, this.workspaceId),
          params.environmentId
            ? eq(environmentInstances.environmentId, params.environmentId)
            : undefined,
        ),
      )
      .orderBy(asc(environmentInstances.createdAt));

  findById = async (id: string): Promise<EnvironmentInstanceItem | undefined> => {
    const [row] = await this.db
      .select()
      .from(environmentInstances)
      .where(and(eq(environmentInstances.id, id), this.ownership()))
      .limit(1);

    return row;
  };

  /**
   * The working copy that already occupies this directory, if any. One instance
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
      .where(and(eq(environmentInstances.workingDirectory, workingDirectory), this.ownership()))
      .limit(1);

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

    const [row] = await this.db
      .insert(environmentInstances)
      .values({
        ...binding,
        configuration,
        // Taken here rather than read through the environment at use time: this
        // is the definition this instance was actually built from, and keeping
        // it is what lets a later comparison say "the specification moved".
        configurationSnapshot: environment.configuration,
        environmentId,
        name,
        workingDirectory,
      })
      .returning();

    return row;
  };

  update = async (
    id: string,
    params: Partial<Pick<NewEnvironmentInstance, 'configuration' | 'enabled' | 'name' | 'status'>>,
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
