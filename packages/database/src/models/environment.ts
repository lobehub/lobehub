import type { EnvironmentConfiguration } from '@lobechat/types';
import { and, asc, eq, isNull } from 'drizzle-orm';

import type { EnvironmentItem, NewEnvironment } from '../schemas';
import { environments } from '../schemas';
import type { LobeChatDatabase } from '../type';
import { buildWorkspacePayload } from '../utils/workspace';

/**
 * The declarative half of an environment: what it should contain, not what it
 * currently does. `configuration` is the specification — the sources to check
 * out, what to run to make them usable, what the work needs to run on — and
 * every materialization of it (a sandbox snapshot, a folder on a device) is a
 * cache that can be rebuilt from this row and thrown away.
 *
 * Reads and writes are scoped to the MEMBER, including inside a workspace where
 * `user_id` merely records the creator. That is narrower than most workspace
 * resources and deliberately so, because the specification is not the only
 * thing the id addresses: an execution plane keeps the materialized state under
 * it, and that state carries whatever a session left in a home directory —
 * including the token a CLI logged in with. An environment a colleague can
 * select is an identity a colleague can borrow, and the borrower would see
 * nothing unusual, only a CLI that happens to be signed in.
 *
 * Sharing an environment is therefore not a matter of widening this filter. It
 * belongs to `project_environments`, which references a specification without
 * handing over anything built from it.
 */
export class EnvironmentModel {
  private db: LobeChatDatabase;
  private userId: string;
  private workspaceId?: string;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.db = db;
    this.userId = userId;
    this.workspaceId = workspaceId;
  }

  /**
   * Always both: the member who owns the environment AND the workspace it was
   * made in. `buildWorkspaceWhere` is wrong here — without a `visibility`
   * column it resolves a workspace to "every row in it", which is exactly the
   * sharing this resource must not have.
   */
  private ownership = () =>
    and(
      eq(environments.userId, this.userId),
      this.workspaceId
        ? eq(environments.workspaceId, this.workspaceId)
        : isNull(environments.workspaceId),
    );

  query = async (): Promise<EnvironmentItem[]> =>
    this.db
      .select()
      .from(environments)
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
