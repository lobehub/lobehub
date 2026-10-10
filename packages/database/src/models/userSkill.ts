import { and, asc, eq, inArray, isNull } from 'drizzle-orm';

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

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.db = db;
    this.userId = userId;
    this.workspaceId = workspaceId;
  }

  private scope = () =>
    buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, documents);

  private bundleWhere = () =>
    and(
      this.scope(),
      eq(documents.fileType, SKILL_BUNDLE_FILE_TYPE),
      eq(documents.source, USER_SKILL_SOURCE),
      isNull(documents.parentId),
    );

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
        .where(eq(documents.id, id));
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
          this.scope(),
          inArray(
            documents.parentId,
            bundles.map((bundle) => bundle.id),
          ),
          inArray(documents.fileType, [SKILL_INDEX_FILE_TYPE, SKILL_SCRIPT_FILE_TYPE]),
        ),
      )
      .orderBy(asc(documents.filename));
    return bundles.map((bundle) => {
      const own = children.filter((child) => child.parentId === bundle.id);
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

  /** Every skill in the library. */
  findAll = async (): Promise<UserSkillItem[]> => {
    const bundles = await this.db
      .select()
      .from(documents)
      .where(this.bundleWhere())
      .orderBy(asc(documents.filename));
    return this.load(bundles);
  };

  /** The skills with these names, for a run that loads them. */
  findByNames = async (names: string[]): Promise<UserSkillItem[]> => {
    if (!names.length) return [];
    const bundles = await this.db
      .select()
      .from(documents)
      .where(and(this.bundleWhere(), inArray(documents.filename, names)));
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
