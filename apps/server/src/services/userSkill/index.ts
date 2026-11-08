import { buildUserSkillIdentifier, USER_SKILLS_IDENTIFIER_PREFIX } from '@lobechat/const';
import type { LobeChatDatabase } from '@lobechat/database';
import { resourcesTreePrompt } from '@lobechat/prompts';
import type { SkillResourceMeta } from '@lobechat/types';
import { sha256 } from 'js-sha256';
import pMap from 'p-map';

import { FileModel } from '@/database/models/file';
import {
  type UserSkillArchiveUpload,
  type UserSkillFile,
  type UserSkillFileEdits,
  type UserSkillItem,
  UserSkillModel,
  type UserSkillOrigin,
  type UserSkillVersion,
} from '@/database/models/userSkill';

import { renderSkillIndexContent, validateSkillName } from '../skillManagement/frontmatter';
import { packSkillArchive, type SkillArchiveFile, unpackSkillArchive } from './archive';
import { skillStorage } from './storage';

/** Storage reads one publish runs at once. */
const STORAGE_READ_CONCURRENCY = 5;

/**
 * The user's own skill library: skills that belong to the user rather than to
 * one agent, so any agent or run can load them — a goal batch's execution plan
 * is one, and stays reusable after the goal ends.
 *
 * Every run lists the library (name and description) and can activate a skill
 * by name; a run that names a skill in its plugins — `user-skills:<name>` — gets
 * its content injected up front, scripts included.
 *
 * Every write publishes a version: the whole package zipped and uploaded, then
 * recorded with the write in one transaction. A run reads the skill's
 * documents, which every write leaves equal to its latest version; scripts run
 * from that version's archive.
 */

export const isUserSkillIdentifier = (id: string) => id.startsWith(USER_SKILLS_IDENTIFIER_PREFIX);

/** The skill identifiers a task's config names under `skills`. */
export const readTaskSkillIds = (config: unknown): string[] => {
  const skills = (config as { skills?: unknown } | null | undefined)?.skills;
  return Array.isArray(skills)
    ? skills.filter((id): id is string => typeof id === 'string' && !!id)
    : [];
};

const toName = (identifier: string) => identifier.slice(USER_SKILLS_IDENTIFIER_PREFIX.length);

/**
 * The canonical identifier of a user skill a model named, or undefined when
 * the name is not one. Models vary casing; user skill names are lowercase
 * slugs, so the lowercased name is the canonical one.
 */
export const canonicalUserSkillIdentifier = (name: string): string | undefined => {
  const canonical = name.trim().toLowerCase();
  return isUserSkillIdentifier(canonical) ? canonical : undefined;
};

/** A skill as the skill pool and the skills runtime take it. */
export interface UserRuntimeSkill {
  /** The latest version's archive, which `execScript` unpacks to run its scripts. */
  archive?: { fileHash: string; url: string };
  /** `SKILL.md` alone — `activateSkill` appends the tree of its scripts itself. */
  body: string;
  /** `SKILL.md`, then the tree of its scripts: what a run injects up front. */
  content: string;
  description: string;
  identifier: string;
  name: string;
  resources?: Record<string, SkillResourceMeta>;
  title: string;
}

export interface UserSkillDetail extends UserSkillItem {
  identifier: string;
  /** Each version's number, note and origin; its package is read with `getVersion`. */
  versions: Omit<UserSkillVersion, 'archive' | 'content'>[];
}

/** One version as it shipped: its `SKILL.md` and the files beside it. */
export interface UserSkillVersionDetail {
  content: string;
  /**
   * The files that version shipped. Absent on a version from before archives,
   * which kept only its `SKILL.md`: read the skill's current files.
   */
  files?: SkillArchiveFile[];
  note?: string;
  origin?: UserSkillOrigin;
  version: number;
}

const MAX_NAME_ATTEMPTS = 50;

/** Writes that lose the race to another publish rebuild their archive this many times. */
const MAX_PUBLISH_ATTEMPTS = 3;

/** The package after `edits`: removed paths dropped, upserted ones replaced or added. */
const applyEdits = (files: UserSkillFile[], edits?: UserSkillFileEdits): UserSkillFile[] => {
  if (!edits) return files;
  const byPath = new Map(files.map((file) => [file.path, file]));
  for (const path of edits.remove ?? []) byPath.delete(path);
  for (const file of edits.upsert ?? []) byPath.set(file.path, file);
  return [...byPath.values()];
};

const toResources = (all: UserSkillFile[]): Record<string, SkillResourceMeta> | undefined => {
  // Resources are served inline as text. A binary file's bytes sit in its
  // `files` row, which the skills runtime does not read for user skills yet, so
  // it is left out rather than offered as an empty text file.
  const files = all.filter((file) => !file.fileId);
  return files.length
    ? Object.fromEntries(
        files.map((file) => [
          file.path,
          { content: file.content, fileHash: sha256(file.content), size: file.content.length },
        ]),
      )
    : undefined;
};

export const toRuntimeSkill = (skill: UserSkillItem): UserRuntimeSkill => {
  const identifier = buildUserSkillIdentifier(skill.name);
  const resources = toResources(skill.files);
  return {
    ...(skill.archive && { archive: { fileHash: skill.archive.fileHash, url: skill.archive.url } }),
    body: skill.content,
    content: resources
      ? `${skill.content}\n\n${resourcesTreePrompt(identifier, resources)}`
      : skill.content,
    description: skill.description,
    identifier,
    // The name a model activates it by, the same way agent-document skills do.
    name: identifier,
    resources,
    title: skill.title,
  };
};

export class UserSkillService {
  private model: UserSkillModel;
  private db: LobeChatDatabase;
  private userId: string;
  private workspaceId?: string;

  /**
   * `callerAgentVisibility` is the run's agent: a workspace-public agent reads
   * none of its caller's (private) skills.
   */
  constructor(
    db: LobeChatDatabase,
    userId: string,
    workspaceId?: string,
    callerAgentVisibility?: 'private' | 'public' | null,
  ) {
    this.model = new UserSkillModel(db, userId, workspaceId, callerAgentVisibility);
    this.db = db;
    this.userId = userId;
    this.workspaceId = workspaceId;
  }

  private owner = () => ({ db: this.db, userId: this.userId, workspaceId: this.workspaceId });

  /**
   * Zips a package and uploads it, keyed by its hash: the same package
   * published again lands on the same object.
   */
  private publish = async (skillMd: string, files: UserSkillFile[]) => {
    const binaryIds = files.flatMap((file) => (file.fileId ? [file.fileId] : []));
    const stored = binaryIds.length
      ? await new FileModel(this.db, this.userId, this.workspaceId).findByIds(binaryIds)
      : [];
    // A package's size is the caller's, so its storage reads go a few at a time.
    const entries = await pMap(
      files,
      async (file) => {
        if (!file.fileId) return { data: file.content, path: file.path };
        const row = stored.find((item) => item.id === file.fileId);
        if (!row) throw new Error(`Skill file ${file.path} names a file that is not there`);
        return { data: await skillStorage.read(this.owner(), row.url), path: file.path };
      },
      { concurrency: STORAGE_READ_CONCURRENCY },
    );
    const { bytes, hash } = packSkillArchive(skillMd, entries);
    const url = `skills/user/${hash}.zip`;
    await skillStorage.write(this.owner(), url, bytes);
    return { fileHash: hash, size: bytes.length, url } satisfies UserSkillArchiveUpload;
  };

  /** A free name from `base`: `base`, then `base-2`, `base-3`, … */
  private freeName = async (base: string) => {
    const name = validateSkillName(base);
    for (let attempt = 1; attempt <= MAX_NAME_ATTEMPTS; attempt++) {
      const candidate = attempt === 1 ? name : `${name}-${attempt}`;
      if (!(await this.model.nameTaken(candidate))) return candidate;
    }
    throw new Error(`No free skill name for ${name}`);
  };

  /** Creates a skill at v1; the name is made unique within the library. */
  createSkill = async (params: {
    body: string;
    description: string;
    files?: UserSkillFile[];
    name: string;
    note?: string;
    origin?: UserSkillOrigin;
    title: string;
  }): Promise<UserSkillItem> => {
    const name = await this.freeName(params.name);
    const content = renderSkillIndexContent({
      bodyMarkdown: params.body,
      description: params.description,
      name,
    });
    return this.model.create({
      archive: await this.publish(content, params.files ?? []),
      content,
      description: params.description,
      files: params.files,
      name,
      note: params.note,
      origin: params.origin,
      title: params.title,
    });
  };

  /** Writes and publishes the next version of a skill. Returns its number. */
  reviseSkill = async (
    id: string,
    params: {
      body: string;
      files?: UserSkillFileEdits;
      note?: string;
      origin?: UserSkillOrigin;
    },
  ): Promise<number | undefined> => {
    for (let attempt = 1; attempt <= MAX_PUBLISH_ATTEMPTS; attempt++) {
      const skill = await this.model.findById(id);
      if (!skill) return undefined;
      const content = renderSkillIndexContent({
        bodyMarkdown: params.body,
        description: skill.description,
        name: skill.name,
      });
      // The archive is the package as it reads after this write, so it is built
      // from the version read here; a publish landing in between makes it stale.
      const result = await this.model.revise(id, {
        archive: await this.publish(content, applyEdits(skill.files, params.files)),
        baseVersion: skill.version,
        content,
        files: params.files,
        note: params.note,
        origin: params.origin,
      });
      if (result !== 'stale') return result;
    }
    throw new Error(`Skill ${id} kept changing while this version was published`);
  };

  getSkill = async (id: string): Promise<UserSkillDetail | undefined> => {
    const skill = await this.model.findById(id);
    if (!skill) return undefined;
    const versions = await this.model.listVersions(id);
    return {
      ...skill,
      identifier: buildUserSkillIdentifier(skill.name),
      versions: versions.map(({ archive: _, content: __, ...version }) => version),
    };
  };

  /** One version as it shipped, read back from its archive. */
  getVersion = async (id: string, version: number): Promise<UserSkillVersionDetail | undefined> => {
    const found = (await this.model.listVersions(id)).find((item) => item.version === version);
    if (!found) return undefined;
    const { note, origin } = found;
    if (!found.archive) return { content: found.content ?? '', note, origin, version };
    const unpacked = unpackSkillArchive(await skillStorage.read(this.owner(), found.archive.url));
    return { ...unpacked, note, origin, version };
  };

  /** Every skill in the library, shaped for a run. */
  listRuntimeSkills = async (): Promise<UserRuntimeSkill[]> =>
    (await this.model.findAll()).map(toRuntimeSkill);

  /**
   * What every run lists: identifier, name and description of each library
   * skill, without reading any body. Cheap however large the library grows.
   */
  listCatalog = async (options?: { includeGenerated?: boolean }) =>
    (await this.model.listCatalog(options)).map((skill) => {
      const identifier = buildUserSkillIdentifier(skill.name);
      return {
        description: skill.description,
        generated: skill.generated,
        identifier,
        name: identifier,
        title: skill.title,
      };
    });

  /**
   * Bodies (and scripts) of just the skills a run pins or names.
   * `trustedGenerated` lists generated skills the run's own Task names: those
   * load even through a workspace-public agent (it is the goal's own plan).
   */
  loadRuntimeSkills = async (
    identifiers: Iterable<string>,
    { trustedGenerated = [] }: { trustedGenerated?: Iterable<string> } = {},
  ): Promise<UserRuntimeSkill[]> => {
    const names = [...new Set(identifiers)].filter(isUserSkillIdentifier).map(toName);
    if (!names.length) return [];
    const trusted = [...new Set(trustedGenerated)].filter(isUserSkillIdentifier).map(toName);
    return (await this.model.findByNames(names, { trustedGenerated: trusted })).map(toRuntimeSkill);
  };
}
