import type { EnvironmentConfiguration } from '@lobechat/types';
import { and, asc, eq, isNull } from 'drizzle-orm';

import type { EnvironmentItem, NewEnvironment } from '../schemas';
import { environmentInstances, environments, users } from '../schemas';
import type { LobeChatDatabase } from '../type';
import { buildWorkspacePayload, buildWorkspaceWhere } from '../utils/workspace';

export interface EnvironmentCreator {
  avatar: string | null;
  fullName: string | null;
  id: string | null;
  username: string | null;
}

export type EnvironmentWithCreator = Pick<
  EnvironmentItem,
  | 'configuration'
  | 'createdAt'
  | 'description'
  | 'id'
  | 'name'
  | 'updatedAt'
  | 'userId'
  | 'workspaceId'
> & { creator: EnvironmentCreator | null };

/** Canonical GitHub source only; credentials and arbitrary clone transports are never persisted. */
export const normalizeProjectRepository = (value: string): string => {
  const ssh = /^git@github\.com:([^/]+\/[^/]+?)(?:\.git)?$/.exec(value.trim());
  const url = new URL(ssh ? `https://github.com/${ssh[1]}` : value.trim());
  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'github.com' ||
    url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error('Use a GitHub repository URL without credentials');
  const path = url.pathname.replace(/\/$/, '').replace(/\.git$/, '');
  if (!/^\/[\w.-]+\/[\w.-]+$/.test(path)) throw new Error('Use a GitHub repository URL');
  return `https://github.com${path}`;
};

/**
 * Single-aggregate access to abstract environments and their materialized
 * instances. Cross-table flows (e.g. binding a project directory, which
 * upserts environment + instance + project link in one transaction) live in
 * `repositories/projectDirectory` and compose this model with a tx handle.
 */
/**
 * Rows this member owns. Always both the member AND the workspace the
 * environment was made in: `buildWorkspaceWhere` is wrong here — without a
 * `visibility` column it resolves a workspace to "every row in it", which is
 * exactly the sharing this resource must not have (see {@link EnvironmentModel}).
 *
 * Exported because instances inherit their scope from the environment and have
 * no owner column of their own, so they have to reach ownership through here.
 */
export const environmentOwnership = (userId: string, workspaceId?: string) =>
  and(
    eq(environments.userId, userId),
    workspaceId ? eq(environments.workspaceId, workspaceId) : isNull(environments.workspaceId),
  );

/**
 * The declarative half of an environment: what it should contain, not what it
 * currently does. `configuration` is the specification — the sources to check
 * out, what to run to make them usable, what the work needs to run on — and
 * every materialization of it (a sandbox snapshot, a folder on a device) is a
 * cache that can be rebuilt from this row and thrown away.
 *
 * Reads and writes are scoped to the MEMBER, including inside a workspace where
 * `user_id` merely records the creator. That is narrower than most workspace
 * resources and deliberately so, by one step of reasoning worth spelling out:
 * an instance has no owner column and inherits its scope from here, and an
 * instance's captured state carries whatever a session left in a home directory
 * — including the token a CLI logged in with. So an environment a colleague can
 * select is an identity a colleague can borrow, and the borrower would see
 * nothing unusual, only a CLI that happens to be signed in.
 *
 * Sharing an environment is therefore not a matter of widening this filter.
 * `project_environments` exists to reference a specification without handing
 * over anything built from it — but taking that path needs `environments`'
 * instances to carry an owner of their own first, or a shared specification
 * quietly becomes a shared snapshot again.
 */
export class EnvironmentModel {
  constructor(
    private readonly db: LobeChatDatabase,
    private readonly userId: string,
    private readonly workspaceId?: string,
  ) {}

  private scope() {
    return { userId: this.userId, workspaceId: this.workspaceId };
  }

  /** Enabled environments visible in the current workspace scope. */
  async list() {
    return this.db
      .select({
        id: environments.id,
        name: environments.name,
        configuration: environments.configuration,
      })
      .from(environments)
      .where(and(buildWorkspaceWhere(this.scope(), environments), eq(environments.enabled, true)));
  }

  /** Enabled, workspace-visible lookup used when linking projects or binding directories. */
  async findEnabledById(id: string) {
    const [row] = await this.db
      .select()
      .from(environments)
      .where(
        and(
          eq(environments.id, id),
          buildWorkspaceWhere(this.scope(), environments),
          eq(environments.enabled, true),
        ),
      );
    return row;
  }

  async save(input: { id?: string; name: string; repositoryUrl?: string }) {
    const source = input.repositoryUrl?.trim();
    const configuration: EnvironmentConfiguration = source
      ? { sources: [{ kind: 'git', url: normalizeProjectRepository(source) }] }
      : {};
    if (input.id) {
      const [existing] = await this.db
        .select()
        .from(environments)
        .where(
          and(
            eq(environments.id, input.id),
            buildWorkspaceWhere(this.scope(), environments),
            eq(environments.userId, this.userId),
          ),
        );
      if (!existing) throw new Error('Environment not found or access denied');
      const [row] = await this.db
        .update(environments)
        .set({
          name: input.name.trim(),
          configuration: { ...existing.configuration, sources: configuration.sources ?? [] },
          updatedAt: new Date(),
        })
        .where(eq(environments.id, existing.id))
        .returning();
      return row;
    }
    const [row] = await this.db
      .insert(environments)
      .values({
        name: input.name.trim(),
        configuration,
        userId: this.userId,
        workspaceId: this.workspaceId,
      })
      .returning();
    return row;
  }

  /** Device instances are unique per (device, workingDirectory) — see the schema constraint. */
  async findDeviceInstance(deviceId: string, workingDirectory: string) {
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
  }

  async createDeviceInstance(input: {
    configurationSnapshot: EnvironmentConfiguration;
    deviceId: string;
    environmentId: string;
    name: string;
    workingDirectory: string;
  }) {
    const [row] = await this.db
      .insert(environmentInstances)
      .values({ ...input, kind: 'device' })
      .returning();
    return row;
  }

  private ownership = () => environmentOwnership(this.userId, this.workspaceId);

  /**
   * Environments with the member who made them.
   *
   * `user_id` is the creator, and in a workspace two colleagues each keep their
   * own — so a list that shows only names cannot say whose is whose. The join
   * is left because a removed account must not take its environments out of
   * the listing with it.
   */
  query = async (): Promise<EnvironmentWithCreator[]> =>
    this.db
      .select({
        configuration: environments.configuration,
        createdAt: environments.createdAt,
        creator: {
          avatar: users.avatar,
          fullName: users.fullName,
          id: users.id,
          username: users.username,
        },
        description: environments.description,
        id: environments.id,
        name: environments.name,
        updatedAt: environments.updatedAt,
        userId: environments.userId,
        workspaceId: environments.workspaceId,
      })
      .from(environments)
      .leftJoin(users, eq(environments.userId, users.id))
      .where(this.ownership())
      .orderBy(asc(environments.createdAt));

  findById = async (id: string): Promise<EnvironmentItem | undefined> => {
    const [row] = await this.db
      .select()
      .from(environments)
      .where(and(eq(environments.id, id), this.ownership()))
      .limit(1);

    return row;
  };

  create = async (params: {
    configuration?: EnvironmentConfiguration;
    description?: string | null;
    name: string;
  }): Promise<EnvironmentItem> => {
    const [row] = await this.db
      .insert(environments)
      .values(
        buildWorkspacePayload(
          { userId: this.userId, workspaceId: this.workspaceId },
          {
            // An environment with nothing declared yet is a normal state: it is
            // named first and specified once the person knows what they want in
            // it. The column stays NOT NULL so a reader never has to tell
            // "declared nothing" apart from "declared, but the row predates the
            // column".
            configuration: params.configuration ?? {},
            description: params.description ?? null,
            name: params.name,
          },
        ),
      )
      .returning();

    return row;
  };

  update = async (
    id: string,
    params: Partial<Pick<NewEnvironment, 'configuration' | 'description' | 'enabled' | 'name'>>,
  ): Promise<EnvironmentItem | undefined> => {
    const [row] = await this.db
      .update(environments)
      .set({ ...params, updatedAt: new Date() })
      .where(and(eq(environments.id, id), this.ownership()))
      .returning();

    return row;
  };

  /**
   * Removes only the specification. Anything materialized from it belongs to
   * the execution plane, and the caller deletes it there first — dropping this
   * row while a snapshot lives on would leave storage nobody can name, and
   * therefore nobody can reclaim.
   */
  delete = async (id: string): Promise<EnvironmentItem | undefined> => {
    const [row] = await this.db
      .delete(environments)
      .where(and(eq(environments.id, id), this.ownership()))
      .returning();

    return row;
  };
}
