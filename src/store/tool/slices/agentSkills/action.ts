import type {
  CreateSkillInput,
  ImportGitHubInput,
  ImportUrlInput,
  ImportZipInput,
  SkillImportResult,
  UpdateSkillInput,
} from '@lobechat/types';

import {
  createReplicaSlice,
  linkReplicaEntity,
  recordLens,
  type ReplicaSyncResult,
} from '@/libs/replica';
import { agentSkillService } from '@/services/skill';
import type { StoreSetter } from '@/store/types';

import type { ToolStore } from '../../store';
import { useToolStore } from '../../store';
import {
  AGENT_SKILL_LIST_KEY,
  type AgentSkillDetail,
  agentSkillDetailEntity,
  type AgentSkillDetailItem,
  agentSkillDetailResource,
  agentSkillListEntity,
  type AgentSkillListItem,
  agentSkillListResource,
} from './projection';

/** The skills list has a single entry; its params carry no filter. */
const LIST_PARAMS = {} as Record<string, never>;

/** Sync result of the skills list: replica flags plus the value the UI reads. */
export interface AgentSkillsSyncResult extends ReplicaSyncResult {
  /** The installed skills, `undefined` until the first entry lands. */
  data: AgentSkillListItem[] | undefined;
  /** A request is in flight and there is nothing to show for this entry yet. */
  isLoading: boolean;
  /** Alias of `revalidate`, kept for the existing "reload skills" controls. */
  mutate: () => Promise<unknown>;
}

/** Sync result of one skill detail page. */
export interface AgentSkillDetailSyncResult extends ReplicaSyncResult {
  /** The detail value: the skill and its resource tree. */
  data: AgentSkillDetail | undefined;
  /** A request is in flight and there is nothing to show for this entry yet. */
  isLoading: boolean;
}

type Setter = StoreSetter<ToolStore>;

export const createAgentSkillsSlice = (set: Setter, get: () => ToolStore, _api?: unknown) =>
  new AgentSkillsActionImpl(set, get, _api);

export class AgentSkillsActionImpl {
  readonly #detail;
  readonly #list;
  /** One skill lives in the list row and in every loaded detail entry. */
  readonly #skill;

  constructor(set: Setter, get: () => ToolStore, _api?: unknown) {
    void _api;
    this.#list = createReplicaSlice(agentSkillListResource, {
      actionPrefix: 'agentSkillList',
      entity: agentSkillListEntity,
      fetcher: () => agentSkillService.list(),
      get,
      merge: (response) => response.data,
      set,
      stateKey: 'agentSkillListReplica',
      view: recordLens<ToolStore, AgentSkillListItem[]>('agentSkillListMap'),
    });
    this.#detail = createReplicaSlice(agentSkillDetailResource, {
      actionPrefix: 'agentSkillDetail',
      entity: agentSkillDetailEntity,
      fetcher: (id) => this.#fetchDetail(id),
      get,
      set,
      stateKey: 'agentSkillDetailReplica',
      view: recordLens<ToolStore, AgentSkillDetail>('agentSkillDetailMap'),
    });
    this.#skill = linkReplicaEntity<AgentSkillListItem>([this.#list, this.#detail]);
  }

  #fetchDetail = async (id: string): Promise<AgentSkillDetail> => {
    const [skillDetail, resourceTree] = await Promise.all([
      agentSkillService.getById(id),
      agentSkillService.listResources(id, true),
    ]);
    return { resourceTree, skillDetail };
  };

  /**
   * Fetch the list and write it straight into the replica. `refreshAgentSkills`
   * is also called from flows where the list hook is not mounted (installing a
   * suggested skill from the create-agent modal), and it must populate the
   * store regardless, so this does not just revalidate the SWR entry.
   */
  #refreshList = async (): Promise<void> => {
    const response = await agentSkillService.list();
    this.#list.replace(LIST_PARAMS, response);
  };

  createAgentSkill = async (
    params: CreateSkillInput,
  ): Promise<AgentSkillDetailItem | undefined> => {
    const result = await agentSkillService.createSkill(params);
    if (result) {
      this.#list.update(AGENT_SKILL_LIST_KEY, (items) =>
        items && !items.some((item) => item.id === result.id) ? [result, ...items] : items,
      );
    }
    await this.#refreshList();
    return result;
  };

  deleteAgentSkill = async (id: string): Promise<void> => {
    await agentSkillService.deleteSkill(id);
    // Drops the list row and the loaded detail entry in one fan-out.
    this.#skill.remove(id);
    await this.#refreshList();
  };

  importAgentSkillFromGitHub = async (
    params: ImportGitHubInput,
  ): Promise<SkillImportResult | undefined> => {
    const result = await agentSkillService.importFromGitHub(params);
    await this.#refreshList();
    return result;
  };

  importAgentSkillFromUrl = async (
    params: ImportUrlInput,
  ): Promise<SkillImportResult | undefined> => {
    const result = await agentSkillService.importFromUrl(params);
    await this.#refreshList();
    return result;
  };

  importAgentSkillFromZip = async (
    params: ImportZipInput,
  ): Promise<SkillImportResult | undefined> => {
    const result = await agentSkillService.importFromZip(params);
    await this.#refreshList();
    return result;
  };

  refreshAgentSkills = async (): Promise<void> => {
    await this.#refreshList();
  };

  updateAgentSkill = async (
    params: UpdateSkillInput,
  ): Promise<AgentSkillDetailItem | undefined> => {
    const result = await this.#skill.optimistic(
      params.id,
      (skill) => ({
        ...skill,
        ...(params.name !== undefined ? { name: params.name } : {}),
        ...(params.description !== undefined ? { description: params.description } : {}),
        ...(params.manifest ? { manifest: { ...skill.manifest, ...params.manifest } } : {}),
      }),
      () => agentSkillService.updateSkill(params),
    );
    // The detail holds the full skill (content, resources); take the server value.
    this.#detail.update(params.id, (data) => (data ? { ...data, skillDetail: result } : data));
    await this.#refreshList();
    return result;
  };

  /**
   * Fetch orchestration only; read the value through `agentSkillDetailMap[id]`.
   */
  useFetchAgentSkillDetail = (skillId?: string): AgentSkillDetailSyncResult => {
    const sync = this.#detail.useSync(skillId || null);
    const data = useToolStore((s) => (skillId ? s.agentSkillDetailMap[skillId] : undefined));
    return {
      ...sync,
      data,
      isLoading: !data && (sync.isValidating || !sync.isHydrated),
    };
  };

  /** Fetch orchestration only; read the rows through `agentSkillsSelectors`. */
  useFetchAgentSkills = (enabled: boolean): AgentSkillsSyncResult => {
    const sync = this.#list.useSync(LIST_PARAMS, { enabled });
    const data = useToolStore((s) => s.agentSkillListMap[AGENT_SKILL_LIST_KEY]);
    return {
      ...sync,
      data,
      isLoading: !data && (sync.isValidating || !sync.isHydrated),
      mutate: sync.revalidate,
    };
  };
}

export type AgentSkillsAction = Pick<AgentSkillsActionImpl, keyof AgentSkillsActionImpl>;
