import type { EnvironmentConfiguration, EnvironmentVisibility } from '@lobechat/types';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';

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
  | 'visibility'
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
 * Rows this member OWNS — the filter every write goes through. A public
 * environment is usable by the workspace but editable only by the member who
 * made it, the same split the device rows draw.
 */
export const environmentOwnership = (userId: string, workspaceId?: string) =>
  and(
    eq(environments.userId, userId),
    workspaceId ? eq(environments.workspaceId, workspaceId) : isNull(environments.workspaceId),
  );

/**
 * Rows this member may SEE: their own, plus whatever the workspace publishes.
 *
 * Exported because instances have no owner column and inherit their scope from
 * the environment, so every instance read has to reach visibility through here.
 * That inheritance is the whole reason publishing is a deliberate act: an
 * instance carries what a session left in it, so a published environment hands
 * over its captured state too — a bargain identical to sharing a device, and
 * one the confirmation dialog spells out before anyone makes it.
 *
 * `callerAgentVisibility: 'public'` narrows it to the published rows alone: a
 * workspace-public agent runs on its caller's session, and a private
 * environment's captured state can hold that caller's credentials, so a shared
 * agent must not reach it. Personal mode is unaffected — there every row is the
 * owner's own.
 */
export const environmentVisibility = (
  userId: string,
  workspaceId?: string,
  callerAgentVisibility?: 'private' | 'public' | null,
) => buildWorkspaceWhere({ callerAgentVisibility, userId, workspaceId }, environments);

/**
 * The declarative half of an environment: what it should contain, not what it
 * currently does. `configuration` is the specification — the sources to check
 * out, what to run to make them usable, what the work needs to run on — and
 * every materialization of it (a sandbox snapshot, a folder on a device) is a
 * cache that can be rebuilt from this row and thrown away.
 *
 * Writes are scoped to the MEMBER, including inside a workspace where `user_id`
 * merely records the creator. Reads follow `visibility`, which defaults to
 * private and starts there for every row that predates the column — so nothing
 * became visible to anyone by the act of adding it.
 *
 * Publishing one is a real decision, by one step of reasoning worth spelling
 * out: an instance has no owner column and inherits its scope from here, and an
 * instance's captured state carries whatever a session left in a home directory
 * — including the token a CLI logged in with. So a published environment is an
 * identity a colleague can borrow, and the borrower would see nothing unusual,
 * only a CLI that happens to be signed in. That is the same bargain a shared
 * device makes, which is why it is offered the same way: private by default,
 * published only through a dialog that names the consequence.
 *
 * `project_environments` remains the path for referencing a specification
 * WITHOUT handing over anything built from it. Taking it needs instances to
 * carry an owner of their own first.
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

  private visible = () => environmentVisibility(this.userId, this.workspaceId);

  /**
   * Narrows a listing to one pool.
   *
   * Personal rows have no pool to be in — they are all private to their owner,
   * and there is no workspace for anything to be published to. So asking for
   * the published pool outside a workspace is answered with nothing rather than
   * ignored: a filter that silently does not apply makes two tabs show the same
   * list, which reads as "these are the same rows" when it means "the question
   * did not reach anything".
   */
  private pool = (visibility?: EnvironmentVisibility) => {
    if (!visibility) return undefined;
    if (this.workspaceId) return eq(environments.visibility, visibility);

    return visibility === 'private' ? undefined : sql`false`;
  };

  /**
   * Environments with the member who made them.
   *
   * `user_id` is the creator, and in a workspace two colleagues each keep their
   * own — so a list that shows only names cannot say whose is whose. The join
   * is left because a removed account must not take its environments out of
   * the listing with it.
   *
   * `visibility` narrows to one pool, which is how the workspace page's two
   * tabs are served. Narrowing to `private` still means "mine": the visibility
   * filter already excludes everyone else's private rows, so the tab shows the
   * caller's own unpublished environments rather than every unpublished one.
   */
  query = async (visibility?: EnvironmentVisibility): Promise<EnvironmentWithCreator[]> => {
    // Flat columns, assembled below — NOT a nested `creator: { … }` selection.
    // Drizzle decides whether a joined object is null from the FIRST field it
    // sees: a null there marks the whole object absent, and a later non-null
    // field from the same table does not undo it (`mapResultRow`). Sorted
    // alphabetically, the first field was `avatar` — so every creator without
    // one came back as no creator at all, and their rows rendered as "Unknown".
    const rows = await this.db
      .select({
        configuration: environments.configuration,
        createdAt: environments.createdAt,
        creatorAvatar: users.avatar,
        creatorFullName: users.fullName,
        creatorId: users.id,
        creatorUsername: users.username,
        description: environments.description,
        id: environments.id,
        name: environments.name,
        updatedAt: environments.updatedAt,
        userId: environments.userId,
        visibility: environments.visibility,
        workspaceId: environments.workspaceId,
      })
      .from(environments)
      .leftJoin(users, eq(environments.userId, users.id))
      .where(and(this.visible(), this.pool(visibility)))
      .orderBy(asc(environments.createdAt));

    return rows.map(({ creatorAvatar, creatorFullName, creatorId, creatorUsername, ...row }) => ({
      ...row,
      // The id is what says a creator was found; a deleted account leaves the
      // join empty and the row keeps its place in the listing with no creator.
      creator: creatorId
        ? {
            avatar: creatorAvatar,
            fullName: creatorFullName,
            id: creatorId,
            username: creatorUsername,
          }
        : null,
    }));
  };

  /** Readable, not necessarily writable — a published environment resolves here for every member. */
  findById = async (id: string): Promise<EnvironmentItem | undefined> => {
    const [row] = await this.db
      .select()
      .from(environments)
      .where(and(eq(environments.id, id), this.visible()))
      .limit(1);

    return row;
  };

  /**
   * The caller's own row, or nothing. Every write goes through this, so a
   * member who can see a published environment still cannot rename, respecify
   * or delete it — the request fails closed as NOT_FOUND, exactly like an id
   * that does not exist.
   */
  findOwnedById = async (id: string): Promise<EnvironmentItem | undefined> => {
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
    visibility?: EnvironmentVisibility;
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
            // Private unless the caller says otherwise, and a personal
            // environment has no other state to be in.
            visibility: this.workspaceId ? (params.visibility ?? 'private') : 'private',
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
   * Publishing to the workspace, or taking it back.
   *
   * Owner-only and workspace-only: a personal environment has nobody to be
   * visible to, and a member who merely uses a published one must not be able
   * to unpublish it out from under everyone.
   */
  setVisibility = async (
    id: string,
    visibility: EnvironmentVisibility,
  ): Promise<EnvironmentItem | undefined> => {
    if (!this.workspaceId) return undefined;

    const [row] = await this.db
      .update(environments)
      .set({ updatedAt: new Date(), visibility })
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
