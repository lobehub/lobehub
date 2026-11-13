import { FileSource } from '@lobechat/types';
import { and, asc, eq, inArray, isNotNull, isNull, or, type SQL, sql } from 'drizzle-orm';

import {
  documents,
  files,
  SKILL_BUNDLE_FILE_TYPE,
  SKILL_FILE_FILE_TYPE,
  SKILL_INDEX_FILE_TYPE,
  SKILL_INDEX_FILENAME,
  SKILL_SCRIPT_FILE_TYPE,
  SKILL_VERSION_FILE_TYPE,
  USER_SKILL_SOURCE,
} from '../schemas';
import type { LobeChatDatabase, Transaction } from '../type';
import { buildWorkspacePayload, buildWorkspaceWhere } from '../utils/workspace';
import { FileModel } from './file';
import { nonNull } from './utils/rows';

/**
 * A user-level skill library: the skill's content on the `documents` table,
 * its published versions in `files`.
 *
 * A skill is a `skills/bundle` row owned by the user and bound to no agent, so
 * any agent or run can load it by name; its `content` is the skill's
 * description. Under it sit its `SKILL.md`
 * (`skills/index`) and the files beside it (`skills/file`, the path in
 * `filename`): text in `content`, a binary file's bytes in the `files` row its
 * `fileId` links. These are ordinary documents, edited in place.
 *
 * A version is a release, not an edit: every write publishes the whole package
 * as a zip archive — a `files` row under the bundle (`parentId`, source
 * `skill`), its number, note and origin in `metadata`. An archive never
 * changes, so version N reads exactly the package it shipped, and it is what a
 * sandbox or device unpacks to run the skill's scripts.
 *
 * Skills written before archives keep their versions as `skills/version` rows
 * (the `SKILL.md` alone) and their files as `skills/script`; both are still read.
 *
 * Rows carry `sourceType: 'agent'` so the Page library never lists them.
 */

/** File types a bundle's files are stored as: current, and before `skills/file`. */
const FILE_TYPES = [SKILL_FILE_FILE_TYPE, SKILL_SCRIPT_FILE_TYPE];

/** Source of the `files` rows a skill owns: binary files and version archives. */
const SKILL_FILE_SOURCE = FileSource.Skill;

export interface UserSkillFile {
  /** Text of the file; empty for a binary one. */
  content: string;
  /** A binary file: the `files` row holding its bytes. */
  fileId?: string;
  language?: string;
  /** Path inside the bundle, e.g. `scripts/check.sh`. */
  path: string;
}

/** Files to write beside `SKILL.md` by path, and paths to drop; the rest stay. */
export interface UserSkillFileEdits {
  remove?: string[];
  upsert?: UserSkillFile[];
}

/** A version's archive, once its bytes are in storage. */
export interface UserSkillArchiveUpload {
  fileHash: string;
  size: number;
  /** Storage key of the zip. */
  url: string;
}

export interface UserSkillArchive extends UserSkillArchiveUpload {
  fileId: string;
}

/** Where a skill or a version came from, e.g. the goal batch that wrote it. */
export type UserSkillOrigin = Record<string, unknown>;

export interface UserSkillVersion {
  /** The published package. Absent on a version from before archives. */
  archive?: UserSkillArchive;
  /** `SKILL.md` of a version from before archives; an archived one holds its own. */
  content?: string;
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
  /** The latest published version's archive; absent on a skill from before archives. */
  archive?: UserSkillArchive;
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

type DocumentRow = typeof documents.$inferSelect;

const lineCount = (text: string) => (text ? text.split('\n').length : 0);

const SOURCE_TYPE = 'agent' as const;

const toFile = (row: DocumentRow): UserSkillFile => ({
  content: row.content ?? '',
  ...(row.fileId && { fileId: row.fileId }),
  ...(row.metadata?.language && { language: row.metadata.language as string }),
  path: row.filename ?? '',
});

const toArchive = (row: typeof files.$inferSelect): UserSkillArchive => ({
  fileHash: row.fileHash ?? '',
  fileId: row.id,
  size: row.size,
  url: row.url,
});

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
    fileId?: string;
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
        fileId: params.fileId,
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

  /** The caller's own `files` rows: a skill's archives and binary files. */
  private filesScope = () =>
    and(
      buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, files),
      eq(files.userId, this.userId),
      eq(files.source, SKILL_FILE_SOURCE),
    );

  /** The archive rows under these bundles, every version. */
  private archiveRows = (bundleIds: string[]) =>
    this.db
      .select()
      .from(files)
      .where(
        and(
          this.filesScope(),
          inArray(files.parentId, bundleIds),
          isNotNull(sql`${files.metadata} -> 'skillVersion'`),
        ),
      );

  /** Writes files beside `SKILL.md` in place by path, and drops removed ones. */
  private writeFiles = async (tx: Transaction, bundleId: string, edits: UserSkillFileEdits) => {
    const atPath = (path: string) =>
      and(
        this.scope(),
        eq(documents.parentId, bundleId),
        inArray(documents.fileType, FILE_TYPES),
        eq(documents.filename, path),
      );
    for (const path of edits.remove ?? []) await tx.delete(documents).where(atPath(path));
    for (const file of edits.upsert ?? []) {
      // A binary file's bytes live in its `files` row, not here.
      const content = file.fileId ? '' : file.content;
      const metadata = file.language ? { language: file.language } : undefined;
      const [updated] = await tx
        .update(documents)
        .set({
          content,
          fileId: file.fileId ?? null,
          // A file written as a script before is a file now.
          fileType: SKILL_FILE_FILE_TYPE,
          metadata,
          totalCharCount: content.length,
          totalLineCount: lineCount(content),
          updatedAt: new Date(),
        })
        .where(atPath(file.path))
        .returning({ id: documents.id });
      if (updated) continue;
      await tx.insert(documents).values(
        this.row({
          content,
          fileId: file.fileId,
          fileType: SKILL_FILE_FILE_TYPE,
          filename: file.path,
          metadata,
          parentId: bundleId,
          title: file.path,
        }),
      );
    }
  };

  /** Records a published version: its archive as a `files` row under the bundle. */
  private insertVersion = async (
    tx: Transaction,
    bundle: { id: string; name: string },
    params: {
      archive: UserSkillArchiveUpload;
      note?: string;
      origin?: UserSkillOrigin;
      version: number;
    },
  ) => {
    await new FileModel(this.db, this.userId, this.workspaceId).create(
      {
        fileHash: params.archive.fileHash,
        fileType: 'application/zip',
        metadata: { note: params.note, origin: params.origin, skillVersion: params.version },
        name: `${bundle.name}@${params.version}.zip`,
        parentId: bundle.id,
        size: params.archive.size,
        source: SKILL_FILE_SOURCE,
        url: params.archive.url,
        // Owner-only, like the skill itself.
        visibility: 'private',
      },
      // Registers the bytes once; the same package published again reuses them.
      true,
      tx,
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
   * Creates a skill at version 1: its bundle, its `SKILL.md`, its files, and
   * v1 published as `archive` — the package as written here, already uploaded.
   */
  create = async (params: {
    archive: UserSkillArchiveUpload;
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
            // The bundle reads as the skill it holds: its description.
            content: params.description,
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
      await this.writeFiles(tx, bundle.id, { upsert: params.files });
      await this.insertVersion(
        tx,
        { id: bundle.id, name: params.name },
        { archive: params.archive, note: params.note, origin: params.origin, version: 1 },
      );
      return bundle.id;
    });
    return (await this.findById(id))!;
  };

  /**
   * Writes the next version: replaces `SKILL.md`, applies the file edits, and
   * publishes `archive` — the package as it reads after them, built from
   * version `baseVersion`. Returns the new version number; `'stale'` when
   * another write published since `baseVersion` (the archive would not match),
   * and undefined when the skill is not the caller's.
   */
  revise = async (
    id: string,
    params: {
      archive: UserSkillArchiveUpload;
      baseVersion: number;
      content: string;
      files?: UserSkillFileEdits;
      note?: string;
      origin?: UserSkillOrigin;
    },
  ): Promise<number | 'stale' | undefined> =>
    this.db.transaction(async (tx) => {
      const [bundle] = await tx
        .select({ filename: documents.filename, id: documents.id, metadata: documents.metadata })
        .from(documents)
        .where(and(this.bundleWhere(), eq(documents.id, id)))
        .for('update')
        .limit(1);
      if (!bundle) return undefined;
      const meta = (bundle.metadata?.userSkill ?? { version: 1 }) as UserSkillMeta;
      if (meta.version !== params.baseVersion) return 'stale';
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
      if (params.files) await this.writeFiles(tx, id, params.files);
      await this.insertVersion(
        tx,
        { id, name: bundle.filename ?? '' },
        { archive: params.archive, note: params.note, origin: params.origin, version },
      );
      return version;
    });

  private load = async (bundles: DocumentRow[]): Promise<UserSkillItem[]> => {
    if (!bundles.length) return [];
    const bundleIds = bundles.map((bundle) => bundle.id);
    const [children, archives] = await Promise.all([
      this.db
        .select()
        .from(documents)
        .where(
          and(
            // The bundles were authorized by the caller's read; their own rows
            // follow them.
            this.ownerScope(),
            inArray(documents.parentId, bundleIds),
            inArray(documents.fileType, [SKILL_INDEX_FILE_TYPE, ...FILE_TYPES]),
          ),
        )
        .orderBy(asc(documents.filename)),
      this.archiveRows(bundleIds),
    ]);
    // One pass over the children, not one per bundle.
    const byBundle = new Map<string, DocumentRow[]>();
    for (const child of children) {
      // Children are selected by inArray(documents.parentId, …), which never matches a NULL parentId.
      const parentId = nonNull(child.parentId, 'documents.parent_id');
      const list = byBundle.get(parentId) ?? [];
      list.push(child);
      byBundle.set(parentId, list);
    }
    return bundles.map((bundle) => {
      const own = byBundle.get(bundle.id) ?? [];
      const meta = (bundle.metadata?.userSkill ?? { version: 1 }) as UserSkillMeta;
      const archive = archives.find(
        (row) =>
          row.parentId === bundle.id &&
          Number((row.metadata as Record<string, unknown>)?.skillVersion) === meta.version,
      );
      return {
        ...(archive && { archive: toArchive(archive) }),
        content: own.find((child) => child.fileType === SKILL_INDEX_FILE_TYPE)?.content ?? '',
        createdAt: bundle.createdAt,
        description: bundle.description ?? '',
        files: own.filter((child) => child.fileType !== SKILL_INDEX_FILE_TYPE).map(toFile),
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

  /**
   * Every version of a skill, oldest first: the published archives, and the
   * `SKILL.md` snapshots of versions from before archives.
   */
  listVersions = async (id: string): Promise<UserSkillVersion[]> => {
    const [archives, legacy] = await Promise.all([
      this.archiveRows([id]),
      this.db
        .select()
        .from(documents)
        .where(
          and(
            this.scope(),
            eq(documents.parentId, id),
            eq(documents.fileType, SKILL_VERSION_FILE_TYPE),
          ),
        ),
    ]);
    const versions = new Map<number, UserSkillVersion>();
    for (const row of legacy) {
      const version = Number(row.metadata?.version ?? 0);
      versions.set(version, {
        content: row.content ?? '',
        createdAt: row.createdAt,
        id: row.id,
        note: row.metadata?.note,
        origin: row.metadata?.origin,
        version,
      });
    }
    for (const row of archives) {
      const metadata = (row.metadata ?? {}) as Record<string, any>;
      const version = Number(metadata.skillVersion);
      versions.set(version, {
        archive: toArchive(row),
        createdAt: row.createdAt,
        id: row.id,
        note: metadata.note,
        origin: metadata.origin,
        version,
      });
    }
    return [...versions.values()].sort((a, b) => a.version - b.version);
  };
}
