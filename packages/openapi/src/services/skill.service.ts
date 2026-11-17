import type { SkillItem, SkillListItem, SkillManifest } from '@lobechat/types';

import type { LobeChatDatabase } from '@/database/type';
import { agentSkillsRouter } from '@/server/routers/lambda/agentSkills';

import { BaseService } from '../common/base.service';
import { decodeOffsetCursor, DEFAULT_PAGE_LIMIT, encodeOffsetCursor } from '../helpers/pagination';
import type { DeletedResource } from '../types/common.type';
import type {
  CreateSkillRequest,
  ImportSkillRequest,
  SkillListQuery,
  SkillResponse,
  SkillSummaryResponse,
  UpdateSkillRequest,
} from '../types/skill.type';

const MANIFEST_KEYS = [
  'author',
  'description',
  'license',
  'name',
  'permissions',
  'repository',
  'sourceUrl',
  'version',
] as const satisfies readonly (keyof SkillManifest)[];

/** The documented manifest fields only; unknown front-matter keys stay internal. */
const toManifest = (manifest: SkillManifest | null | undefined, item: SkillListItem) => {
  const picked: Record<string, unknown> = {};
  for (const key of MANIFEST_KEYS) {
    if (manifest?.[key] !== undefined) picked[key] = manifest[key];
  }
  return {
    ...picked,
    description: manifest?.description ?? item.description ?? '',
    name: manifest?.name ?? item.name,
  } as SkillSummaryResponse['manifest'];
};

const toIso = (value: Date | string) => new Date(value).toISOString();

export const toSkillSummary = (item: SkillListItem): SkillSummaryResponse => ({
  createdAt: toIso(item.createdAt),
  description: item.description ?? null,
  id: item.id,
  identifier: item.identifier,
  manifest: toManifest(item.manifest, item),
  name: item.name,
  source: item.source,
  updatedAt: toIso(item.updatedAt),
});

export const toSkill = (item: SkillItem): SkillResponse => ({
  ...toSkillSummary(item),
  content: item.content ?? null,
  resources: Object.entries(item.resources ?? {})
    .map(([path, meta]) => ({ path, size: meta.size }))
    .sort((a, b) => a.path.localeCompare(b.path)),
});

/**
 * Agent skills REST service.
 *
 * A thin shell over the `agentSkills` tRPC procedures (called server-side), so
 * REST writes get the same workspace RBAC, creator-only row check, import
 * validation (GitHub / URL / ZIP / marketplace) and resource handling as the
 * skill manager in the app.
 */
export class SkillRestService extends BaseService {
  private readonly ctx: { userId: string; workspaceId?: string; workspaceRole?: string };

  constructor(
    db: LobeChatDatabase,
    userId: string | null,
    workspaceId?: string,
    workspaceRole?: string,
  ) {
    super(db, userId, workspaceId);
    this.ctx = { userId: this.userId, workspaceId, workspaceRole };
  }

  private get skills() {
    return agentSkillsRouter.createCaller(this.ctx);
  }

  private async requireSkill(id: string): Promise<SkillItem> {
    const skill = await this.skills.getById({ id });
    if (!skill) throw this.createNotFoundError('Skill not found');
    return skill;
  }

  async listSkills(query: SkillListQuery) {
    const { data } = query.q
      ? await this.skills.search({ query: query.q })
      : await this.skills.list(query.source ? { source: query.source } : undefined);
    // `search` has no source filter of its own
    const rows = query.q && query.source ? data.filter((s) => s.source === query.source) : data;

    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
    const offset = query.cursor ? decodeOffsetCursor(query.cursor) : 0;
    const page = rows.slice(offset, offset + limit);
    const hasMore = offset + page.length < rows.length;

    return {
      hasMore,
      items: page.map(toSkillSummary),
      nextCursor: hasMore ? encodeOffsetCursor(offset + page.length) : null,
      total: rows.length,
    };
  }

  async getSkill(id: string): Promise<SkillResponse> {
    return toSkill(await this.requireSkill(id));
  }

  async createSkill(request: CreateSkillRequest): Promise<SkillResponse> {
    return toSkill((await this.skills.create(request))!);
  }

  async updateSkill(id: string, request: UpdateSkillRequest): Promise<SkillResponse> {
    await this.requireSkill(id);
    await this.skills.update({ content: request.content, id, manifest: request.manifest });
    return this.getSkill(id);
  }

  async deleteSkill(id: string): Promise<DeletedResource> {
    await this.requireSkill(id);
    await this.skills.delete({ id });
    return { deleted: true, id };
  }

  async importSkill(request: ImportSkillRequest) {
    const result = await (async () => {
      switch (request.source) {
        case 'github': {
          return this.skills.importFromGitHub({ branch: request.branch, gitUrl: request.gitUrl });
        }
        case 'url': {
          return this.skills.importFromUrl({ url: request.url });
        }
        case 'zip': {
          return this.skills.importFromZip({ zipFileId: request.zipFileId });
        }
        case 'market': {
          return this.skills.importFromMarket({ identifier: request.identifier });
        }
      }
    })();
    if (!result) throw this.createCommonError('Skill import returned no skill');

    return { skill: toSkill(result.skill), status: result.status };
  }

  async listResources(id: string) {
    return { items: toSkill(await this.requireSkill(id)).resources };
  }

  async readResource(id: string, path: string) {
    const skill = await this.requireSkill(id);
    if (!skill.resources?.[path]) throw this.createNotFoundError(`Resource not found: ${path}`);

    const resource = await this.skills.readResource({ id, path });
    return {
      content: resource.content,
      encoding: resource.encoding,
      fileType: resource.fileType,
      path: resource.path,
      size: resource.size,
    };
  }
}
