import {
  type CreateSkillInput,
  type ImportGitHubInput,
  type ImportUrlInput,
  type ImportZipInput,
  type SkillImportResult,
  type SkillItem,
  type SkillListItem,
  type SkillResourceTreeNode,
  type UpdateSkillInput,
} from '@lobechat/types';
import { produce } from 'immer';
import useSWR, { mutate, type SWRResponse } from 'swr';

import { useClientDataSWR } from '@/libs/swr';
import { agentSkillService } from '@/services/skill';
import { type StoreSetter } from '@/store/types';
import { setNamespace } from '@/utils/storeDebug';

import { type ToolStore } from '../../store';
import { type AgentSkillsState } from './initialState';

const n = setNamespace('agentSkills');

export interface AgentSkillDetailData {
  resourceTree: SkillResourceTreeNode[];
  skillDetail?: SkillItem;
}

type Setter = StoreSetter<ToolStore>;

export const createAgentSkillsSlice = (set: Setter, get: () => ToolStore, _api?: unknown) =>
  new AgentSkillsActionImpl(set, get, _api);

export class AgentSkillsActionImpl {
  readonly #get: () => ToolStore;
  readonly #set: Setter;

  constructor(set: Setter, get: () => ToolStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
  }

  createAgentSkill = async (params: CreateSkillInput): Promise<SkillItem | undefined> => {
    const result = await agentSkillService.createSkill(params);
    await this.#get().refreshAgentSkills();
    return result;
  };

  deleteAgentSkill = async (id: string): Promise<void> => {
    await agentSkillService.deleteSkill(id);

    this.#set(
      produce((draft: AgentSkillsState) => {
        delete draft.agentSkillDetailMap[id];
      }),
      false,
      n('deleteAgentSkill'),
    );

    await mutate(['fetchAgentSkillDetail', id].join('-'), undefined, { revalidate: false });

    await this.#get().refreshAgentSkills();
  };

  fetchAgentSkillDetail = async (id: string): Promise<SkillItem | undefined> => {
    const cached = this.#get().agentSkillDetailMap[id];
    if (cached) return cached;

    const detail = await agentSkillService.getById(id);
    if (detail) {
      this.#set(
        produce((draft: AgentSkillsState) => {
          draft.agentSkillDetailMap[id] = detail;
        }),
        false,
        n('fetchAgentSkillDetail'),
      );
    }
    return detail;
  };

  importAgentSkillFromGitHub = async (
    params: ImportGitHubInput,
  ): Promise<SkillImportResult | undefined> => {
    const result = await agentSkillService.importFromGitHub(params);
    await this.#get().refreshAgentSkills();
    return result;
  };

  importAgentSkillFromUrl = async (
    params: ImportUrlInput,
  ): Promise<SkillImportResult | undefined> => {
    const result = await agentSkillService.importFromUrl(params);
    await this.#get().refreshAgentSkills();
    return result;
  };

  importAgentSkillFromZip = async (
    params: ImportZipInput,
  ): Promise<SkillImportResult | undefined> => {
    const result = await agentSkillService.importFromZip(params);
    await this.#get().refreshAgentSkills();
    return result;
  };

  refreshAgentSkills = async (): Promise<void> => {
    const { data } = await agentSkillService.list();
    this.#set({ agentSkills: data }, false, n('refreshAgentSkills'));
  };

  updateAgentSkill = async (params: UpdateSkillInput): Promise<SkillItem | undefined> => {
    const result = await agentSkillService.updateSkill(params);

    if (result) {
      this.#set(
        produce((draft: AgentSkillsState) => {
          draft.agentSkillDetailMap[params.id] = result;
        }),
        false,
        n('updateAgentSkill'),
      );
    }

    await mutate(['fetchAgentSkillDetail', params.id].join('-'), undefined, { revalidate: false });

    await this.#get().refreshAgentSkills();
    return result;
  };

  useFetchAgentSkillDetail = (skillId?: string): SWRResponse<AgentSkillDetailData> =>
    useClientDataSWR<AgentSkillDetailData>(
      skillId ? ['fetchAgentSkillDetail', skillId].join('-') : null,
      async () => {
        const [detail, resourceTree] = await Promise.all([
          agentSkillService.getById(skillId!),
          agentSkillService.listResources(skillId!, true),
        ]);

        if (detail) {
          this.#set(
            produce((draft: AgentSkillsState) => {
              draft.agentSkillDetailMap[skillId!] = detail;
            }),
            false,
            n('useFetchAgentSkillDetail'),
          );
        }

        return { resourceTree, skillDetail: detail };
      },
      { revalidateOnFocus: false },
    );

  useFetchAgentSkills = (enabled: boolean): SWRResponse<SkillListItem[]> =>
    useSWR<SkillListItem[]>(
      enabled ? 'fetchAgentSkills' : null,
      async () => {
        const { data } = await agentSkillService.list();
        return data;
      },
      {
        fallbackData: [],
        onSuccess: (data) => {
          this.#set({ agentSkills: data }, false, n('useFetchAgentSkills'));
        },
        revalidateOnFocus: false,
      },
    );
}

export type AgentSkillsAction = Pick<AgentSkillsActionImpl, keyof AgentSkillsActionImpl>;
