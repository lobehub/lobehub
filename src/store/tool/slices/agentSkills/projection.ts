import type { SkillResourceTreeNode } from '@lobechat/types';

import { arrayEntity, defineReplica, type ReplicaEntityAdapter } from '@/libs/replica';
import type { agentSkillService } from '@/services/skill';

type SkillListResponse = Awaited<ReturnType<typeof agentSkillService.list>>;

type SkillDetailResponse = Awaited<ReturnType<typeof agentSkillService.getById>>;

/** One row of the installed skills list. */
export type AgentSkillListItem = SkillListResponse['data'][number];

/** The full skill behind a detail page (`getById` — content included). */
export type AgentSkillDetailItem = NonNullable<SkillDetailResponse>;

/**
 * A skill detail entry: the skill plus the resource tree fetched alongside it,
 * so a detail surface paints both from one replica value.
 */
export interface AgentSkillDetail {
  resourceTree: SkillResourceTreeNode[];
  skillDetail?: AgentSkillDetailItem;
}

/**
 * Installed skills of the active scope. The list is not paged, so every loaded
 * skill sits in the single `all` entry (`agentSkillListMap[AGENT_SKILL_LIST_KEY]`).
 */
export const AGENT_SKILL_LIST_KEY = 'all';

/** Every installed skill of the active scope (`agentSkillListMap.all`). */
export const agentSkillListResource = defineReplica<
  Record<string, never>,
  AgentSkillListItem[],
  SkillListResponse
>({
  key: () => AGENT_SKILL_LIST_KEY,
  name: 'agentSkillList',
  storage: 'indexedDB',
  version: 1,
});

/** One skill detail page, keyed by skill id (`agentSkillDetailMap[id]`). */
export const agentSkillDetailResource = defineReplica<string, AgentSkillDetail>({
  key: (id) => id,
  name: 'agentSkillDetail',
  storage: 'indexedDB',
  version: 1,
});

/** Skills are addressed by `id` across the tool store. */
export const agentSkillListEntity: ReplicaEntityAdapter<AgentSkillListItem[], AgentSkillListItem> =
  arrayEntity<AgentSkillListItem>((skill) => skill.id);

/**
 * The detail value wraps one skill: a list-row change patches that skill — the
 * patch merges into the richer `SkillItem`, so fields the list does not carry
 * (content, resources) survive — and deleting it drops the whole detail entry.
 */
export const agentSkillDetailEntity: ReplicaEntityAdapter<AgentSkillDetail, AgentSkillListItem> = {
  has: (data, id) => data.skillDetail?.id === id,
  map: (data, _id, fn) => {
    const current = data.skillDetail;
    if (!current) return data;
    const next = fn(current);
    if (next === undefined) return undefined;
    if (next === (current as AgentSkillListItem)) return data;
    return { ...data, skillDetail: { ...current, ...next } };
  },
};
