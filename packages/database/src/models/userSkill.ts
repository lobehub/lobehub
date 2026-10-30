import { and, asc, eq, inArray, isNull, or, type SQL, sql } from 'drizzle-orm';

import {
  documents,
  SKILL_BUNDLE_FILE_TYPE,
  SKILL_INDEX_FILE_TYPE,
  SKILL_INDEX_FILENAME,
  SKILL_SCRIPT_FILE_TYPE,
  SKILL_VERSION_FILE_TYPE,
  USER_SKILL_SOURCE,
} from '../schemas';
import type { LobeChatDatabase, Transaction } from '../type';
import { buildWorkspacePayload, buildWorkspaceWhere } from '../utils/workspace';

/**
 * A user-level skill library on the `documents` table.
 *
 * A skill is a `skills/bundle` row owned by the user and bound to no agent, so
 * any agent or run can load it by name. Under it sit its `SKILL.md`
 * (`skills/index`), its scripts (`skills/script`, the code in `content`, the
 * language in `metadata.language`) and one `skills/version` row per version —
 * the full `SKILL.md` it read at that version. Versions are rows of their own,
 * not document history: history is trimmed, a version must stay readable.
 *
 * Rows carry `sourceType: 'agent'` so the Page library never lists them.
 */

export interface UserSkillFile {
  content: string;
  language?: string;
  /** Path inside the bundle, e.g. `scripts/check.sh`. */
  path: string;
}

/** Where a skill or a version came from, e.g. the goal batch that wrote it. */
export type UserSkillOrigin = Record<string, unknown>;

export interface UserSkillVersion {
  content: string;
  createdAt: Date;
  id: string;
  note?: string;
  origin?: UserSkillOrigin;
  version: number;
}

export interface UserSkillCatalogItem {
  description: string;
  /**
   * Written by the system for one job (a goal batch's plan), not by the person.
   * Such skills are loaded where they are named, not listed to every run.
   */
  generated: boolean;
  id: string;
  name: string;
  title: string;
}

export interface UserSkillItem {
  /** The current `SKILL.md`. */
  content: string;
  createdAt: Date;
  description: string;
  files: UserSkillFile[];
  id: string;
  name: string;
  origin?: UserSkillOrigin;
  title: string;
  updatedAt: Date;
  version: number;
}

interface UserSkillMeta {
  origin?: UserSkillOrigin;
  version: number;
}

const SOURCE_TYPE = 'agent' as const;

const lineCount = (text: string) => (text ? text.split('\n').length : 0);

export class UserSkillModel {
  private db: LobeChatDatabase;
  private userId: string;
  private workspaceId?: string;

  /**
   * Visibility of the agent a read runs for. A workspace-public agent must not
   * read its caller's private rows — and user skills are private — so such a
   * run sees none of them (see `buildWorkspaceWhere`).
   */
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

  /**
   * The caller's own rows in the current workspace. A user skill belongs to its
   * creator: the workspace scope alone would also admit other members' public
   * rows, putting one member's instructions into another member's runs.
   */
  private scope = () =>
    and(
      buildWorkspaceWhere(
        {
          callerAgentVisibility: this.callerAgentVisibility,
          userId: this.userId,
          workspaceId: this.workspaceId,
        },
        documents,
      ),
      eq(documents.userId, this.userId),
    );

  /** The caller's own rows, whatever agent the read runs for. */
  private ownerScope = () =>
    and(
      buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, documents),
      eq(documents.userId, this.userId),
    );

  private bundleWhere = (scope: SQL | undefined = this.scope()) =>
    and(
      scope,
      eq(documents.fileType, SKILL_BUNDLE_FILE_TYPE),
      eq(documents.source, USER_SKILL_SOURCE),
      isNull(documents.parentId),
    );

  /** A bundle a goal batch generated records the batch in its origin. */
  private generated = () =>
    sql<boolean>`COALESCE(jsonb_exists(${documents.metadata} -> 'userSkill' -> 'origin', 'batchNodeId'), false)`;

  private row = (params: {
    content: string;
    description?: string | null;
    fileType: string;
    filename: string;
    metadata?: Record<string, unknown>;
    parentId?: string;
    title: string;
  }) =>
    buildWorkspacePayload(
      { userId: this.userId, workspaceId: this.workspaceId },
      {
        content: params.content,
        description: params.description ?? null,
        fileType: params.fileType,
        filename: params.filename,
        metadata: params.metadata,
        parentId: params.parentId,
        source: USER_SKILL_SOURCE,
        sourceType: SOURCE_TYPE,
        // Owner-only, like the reads above: never listed to other members.
        visibility: 'private' as const,
        title: params.title,
        totalCharCount: params.content.length,
        totalLineCount: lineCount(params.content),
      },
    );

  private insertVersion = async (
    tx: Transaction,
    bundleId: string,
    params: { content: string; note?: string; origin?: UserSkillOrigin; version: number },
  ) => {
    await tx.insert(documents).values(
      this.row({
        content: params.content,
        fileType: SKILL_VERSION_FILE_TYPE,
        filename: `v${params.version}`,
        metadata: { note: params.note, origin: params.origin, version: params.version },
        parentId: bundleId,
        title: `v${params.version}`,
      }),
    );
  };

  /** Whether the user already has a skill with this name. */
  nameTaken = async (name: string) => {
    const [row] = await this.db
      .select({ id: documents.id })
      .from(documents)
      .where(and(this.bundleWhere(), eq(documents.filename, name)))
      .limit(1);
    return !!row;
  };

  /**
   * Creates a skill at version 1: its bundle, its `SKILL.md`, its scripts, and
   * the v1 snapshot.
   */
  create = async (params: {
    content: string;
    description: string;
    files?: UserSkillFile[];
    name: string;
    note?: string;
    origin?: UserSkillOrigin;
    title: string;
  }): Promise<UserSkillItem> => {
    const id = await this.db.transaction(async (tx) => {
      const [bundle] = await tx
        .insert(documents)
        .values(
          this.row({
            content: '',
            description: params.description,
            fileType: SKILL_BUNDLE_FILE_TYPE,
            filename: params.name,
            metadata: {
              skill: { frontmatter: { description: params.description, name: params.name } },
              userSkill: { origin: params.origin, version: 1 } satisfies UserSkillMeta,
            },
            title: params.title,
          }),
        )
        .returning({ id: documents.id });
      await tx.insert(documents).values(
        this.row({
          content: params.content,
          fileType: SKILL_INDEX_FILE_TYPE,
          filename: SKILL_INDEX_FILENAME,
          parentId: bundle.id,
          title: SKILL_INDEX_FILENAME,
        }),
      );
      for (const file of params.files ?? []) {
        await tx.insert(documents).values(
          this.row({
            content: file.content,
            fileType: SKILL_SCRIPT_FILE_TYPE,
            filename: file.path,
            metadata: file.language ? { language: file.language } : undefined,
            parentId: bundle.id,
            title: file.path,
          }),
        );
      }
      await this.insertVersion(tx, bundle.id, {
        content: params.content,
        note: params.note,
        origin: params.origin,
        version: 1,
      });
      return bundle.id;
    });
    return (await this.findById(id))!;
  };

  /**
   * Writes a new version: replaces the current `SKILL.md` and freezes it as the
   * next version. Returns the new version number, or undefined when the skill
   * is not the caller's.
   */
  revise = async (
    id: string,
    params: { content: string; note?: string; origin?: UserSkillOrigin },
  ): Promise<number | undefined> =>
    this.db.transaction(async (tx) => {
      const [bundle] = await tx
        .select({ id: documents.id, metadata: documents.metadata })
        .from(documents)
        .where(and(this.bundleWhere(), eq(documents.id, id)))
        .for('update')
        .limit(1);
      if (!bundle) return undefined;
      const meta = (bundle.metadata?.userSkill ?? { version: 1 }) as UserSkillMeta;
      const version = meta.version + 1;

      await tx
        .update(documents)
        .set({
          content: params.content,
          totalCharCount: params.content.length,
          totalLineCount: lineCount(params.content),
          updatedAt: new Date(),
        })
        .where(
          and(
            this.scope(),
            eq(documents.parentId, id),
            eq(documents.fileType, SKILL_INDEX_FILE_TYPE),
          ),
        );
      await tx
        .update(documents)
        .set({
          metadata: { ...bundle.metadata, userSkill: { ...meta, version } },
          updatedAt: new Date(),
        })
        .where(and(this.bundleWhere(), eq(documents.id, id)));
      await this.insertVersion(tx, id, {
        content: params.content,
        note: params.note,
        origin: params.origin,
        version,
      });
      return version;
    });

  private load = async (bundles: (typeof documents.$inferSelect)[]): Promise<UserSkillItem[]> => {
    if (!bundles.length) return [];
    const children = await this.db
      .select()
      .from(documents)
      .where(
        and(
          // The bundles were authorized by the caller's read; their own rows
          // follow them.
          this.ownerScope(),
          inArray(
            documents.parentId,
            bundles.map((bundle) => bundle.id),
          ),
          inArray(documents.fileType, [SKILL_INDEX_FILE_TYPE, SKILL_SCRIPT_FILE_TYPE]),
        ),
      )
      .orderBy(asc(documents.filename));
    // One pass over the children, not one per bundle.
    const byBundle = new Map<string, (typeof children)[number][]>();
    for (const child of children) {
      /* v8 ignore next -- unreachable: children are selected by inArray(documents.parentId, …), which never matches a NULL parentId */
      if (!child.parentId) continue;
      const list = byBundle.get(child.parentId) ?? [];
      list.push(child);
      byBundle.set(child.parentId, list);
    }
    return bundles.map((bundle) => {
      const own = byBundle.get(bundle.id) ?? [];
      const meta = (bundle.metadata?.userSkill ?? { version: 1 }) as UserSkillMeta;
      return {
        content: own.find((child) => child.fileType === SKILL_INDEX_FILE_TYPE)?.content ?? '',
        createdAt: bundle.createdAt,
        description: bundle.description ?? '',
        files: own
          .filter((child) => child.fileType === SKILL_SCRIPT_FILE_TYPE)
          .map((child) => ({
            content: child.content ?? '',
            language: child.metadata?.language,
            path: child.filename ?? '',
          })),
        id: bundle.id,
        name: bundle.filename ?? '',
        origin: meta.origin,
        title: bundle.title ?? bundle.filename ?? '',
        updatedAt: bundle.updatedAt,
        version: meta.version,
      };
    });
  };

  findById = async (id: string): Promise<UserSkillItem | undefined> => {
    const bundles = await this.db
      .select()
      .from(documents)
      .where(and(this.bundleWhere(), eq(documents.id, id)))
      .limit(1);
    return (await this.load(bundles))[0];
  };

  /**
   * The library as a catalog: name, title and description from the bundle rows
   * alone, no `SKILL.md` or scripts. What every run lists; bodies are loaded
   * only for the skills a run actually uses (`findByNames`).
   */
  listCatalog = async ({ includeGenerated = true }: { includeGenerated?: boolean } = {}): Promise<
    UserSkillCatalogItem[]
  > => {
    // A bundle a goal batch generated records the batch in its origin. Tested
    // by key existence (never `IS NULL` on an extracted jsonb value), in the
    // query, so a run that lists only hand-made skills never reads the rest.
    const generated = this.generated();
    const rows = await this.db
      .select({
        description: documents.description,
        filename: documents.filename,
        generated,
        id: documents.id,
        title: documents.title,
      })
      .from(documents)
      .where(includeGenerated ? this.bundleWhere() : and(this.bundleWhere(), sql`NOT ${generated}`))
      .orderBy(asc(documents.filename));
    return rows.map((row) => ({
      description: row.description ?? '',
      generated: !!row.generated,
      id: row.id,
      name: row.filename ?? '',
      title: row.title ?? row.filename ?? '',
    }));
  };

  /** Every skill in the library, bodies included. */
  findAll = async (): Promise<UserSkillItem[]> => {
    const bundles = await this.db
      .select()
      .from(documents)
      .where(this.bundleWhere())
      .orderBy(asc(documents.filename));
    return this.load(bundles);
  };

  /** The skills with these names, for a run that loads them. */
  findByNames = async (
    names: string[],
    { trustedGenerated = [] }: { trustedGenerated?: string[] } = {},
  ): Promise<UserSkillItem[]> => {
    if (!names.length) return [];
    // A skill a goal batch generated is that goal's own plan — its units carry
    // it in their brief anyway — so the run whose Task names it gets it even
    // through a workspace-public agent. Only those exact names: a name the
    // model supplies never widens it, and the rest of the caller's private
    // library stays out of such a run.
    const trusted = trustedGenerated.filter((name) => names.includes(name));
    const bundles = await this.db
      .select()
      .from(documents)
      .where(
        and(
          trusted.length
            ? or(
                this.bundleWhere(),
                and(
                  this.bundleWhere(this.ownerScope()),
                  this.generated(),
                  inArray(documents.filename, trusted),
                ),
              )
            : this.bundleWhere(),
          inArray(documents.filename, names),
        ),
      );
    return this.load(bundles);
  };

  /** Every version of a skill, oldest first. */
  listVersions = async (id: string): Promise<UserSkillVersion[]> => {
    const rows = await this.db
      .select()
      .from(documents)
      .where(
        and(
          this.scope(),
          eq(documents.parentId, id),
          eq(documents.fileType, SKILL_VERSION_FILE_TYPE),
        ),
      );
    return rows
      .map((row) => ({
        content: row.content ?? '',
        createdAt: row.createdAt,
        id: row.id,
        note: row.metadata?.note,
        origin: row.metadata?.origin,
        version: Number(row.metadata?.version ?? 0),
      }))
      .sort((a, b) => a.version - b.version);
  };
}
