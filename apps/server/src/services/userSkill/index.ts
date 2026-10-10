import { buildUserSkillIdentifier, USER_SKILLS_IDENTIFIER_PREFIX } from '@lobechat/const';
import type { LobeChatDatabase } from '@lobechat/database';
import { resourcesTreePrompt } from '@lobechat/prompts';
import type { SkillResourceMeta } from '@lobechat/types';
import { sha256 } from 'js-sha256';

import {
  type UserSkillFile,
  type UserSkillItem,
  UserSkillModel,
  type UserSkillOrigin,
  type UserSkillVersion,
} from '@/database/models/userSkill';

import { renderSkillIndexContent, validateSkillName } from '../skillManagement/frontmatter';

/**
 * The user's own skill library: skills that belong to the user rather than to
 * one agent, so any agent or run can load them — a goal batch's execution plan
 * is one, and stays reusable after the goal ends.
 *
 * Every run lists the library (name and description) and can activate a skill
 * by name; a run that names a skill in its plugins — `user-skills:<name>` — gets
 * its content injected up front, scripts included.
 */

export const isUserSkillIdentifier = (id: string) => id.startsWith(USER_SKILLS_IDENTIFIER_PREFIX);

/** A skill as the skill pool and the skills runtime take it. */
export interface UserRuntimeSkill {
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
  versions: UserSkillVersion[];
}

const MAX_NAME_ATTEMPTS = 50;

const toResources = (files: UserSkillFile[]): Record<string, SkillResourceMeta> | undefined =>
  files.length
    ? Object.fromEntries(
        files.map((file) => [
          file.path,
          { content: file.content, fileHash: sha256(file.content), size: file.content.length },
        ]),
      )
    : undefined;

export const toRuntimeSkill = (skill: UserSkillItem): UserRuntimeSkill => {
  const identifier = buildUserSkillIdentifier(skill.name);
  const resources = toResources(skill.files);
  return {
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

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.model = new UserSkillModel(db, userId, workspaceId);
  }

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
    return this.model.create({
      content: renderSkillIndexContent({
        bodyMarkdown: params.body,
        description: params.description,
        name,
      }),
      description: params.description,
      files: params.files,
      name,
      note: params.note,
      origin: params.origin,
      title: params.title,
    });
  };

  /** Writes the next version of a skill's body. Returns its number. */
  reviseSkill = async (
    id: string,
    params: { body: string; note?: string; origin?: UserSkillOrigin },
  ): Promise<number | undefined> => {
    const skill = await this.model.findById(id);
    if (!skill) return undefined;
    return this.model.revise(id, {
      content: renderSkillIndexContent({
        bodyMarkdown: params.body,
        description: skill.description,
        name: skill.name,
      }),
      note: params.note,
      origin: params.origin,
    });
  };

  getSkill = async (id: string): Promise<UserSkillDetail | undefined> => {
    const skill = await this.model.findById(id);
    if (!skill) return undefined;
    return {
      ...skill,
      identifier: buildUserSkillIdentifier(skill.name),
      versions: await this.model.listVersions(id),
    };
  };

  /** Every skill in the library, shaped for a run. */
  listRuntimeSkills = async (): Promise<UserRuntimeSkill[]> =>
    (await this.model.findAll()).map(toRuntimeSkill);
}
