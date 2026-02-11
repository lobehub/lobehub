import type {
  CreateSkillInput,
  ImportGitHubInput,
  ImportUrlInput,
  ImportZipInput,
  SkillImportResult,
  SkillItem,
  SkillListItem,
  SkillResourceTreeNode,
  UpdateSkillInput,
} from '@lobechat/types';
import { produce } from 'immer';
import useSWR, { type SWRResponse } from 'swr';
import type { StateCreator } from 'zustand/vanilla';

import { useClientDataSWR } from '@/libs/swr';
import { agentSkillService } from '@/services/skill';
import { setNamespace } from '@/utils/storeDebug';

import type { ToolStore } from '../../store';
import type { AgentSkillsState } from './initialState';

const n = setNamespace('agentSkills');

export interface AgentSkillDetailData {
  resourceTree: SkillResourceTreeNode[];
  skillDetail?: SkillItem;
}

export interface AgentSkillsAction {
  createAgentSkill: (params: CreateSkillInput) => Promise<SkillItem | undefined>;
  deleteAgentSkill: (id: string) => Promise<void>;
  fetchAgentSkillDetail: (id: string) => Promise<SkillItem | undefined>;
  importAgentSkillFromGitHub: (params: ImportGitHubInput) => Promise<SkillImportResult | undefined>;
  importAgentSkillFromUrl: (params: ImportUrlInput) => Promise<SkillImportResult | undefined>;
  importAgentSkillFromZip: (params: ImportZipInput) => Promise<SkillImportResult | undefined>;
  refreshAgentSkills: () => Promise<void>;
  updateAgentSkill: (params: UpdateSkillInput) => Promise<SkillItem | undefined>;
  useFetchAgentSkillDetail: (skillId?: string) => SWRResponse<AgentSkillDetailData>;
  useFetchAgentSkills: (enabled: boolean) => SWRResponse<SkillListItem[]>;
}

export const createAgentSkillsSlice: StateCreator<
  ToolStore,
  [['zustand/devtools', never]],
  [],
  AgentSkillsAction
> = (set, get) => ({
  createAgentSkill: async (params) => {
    const result = await agentSkillService.createSkill(params);
    await get().refreshAgentSkills();
    return result;
  },

  deleteAgentSkill: async (id) => {
    await agentSkillService.deleteSkill(id);

    // Clean up detail map
    set(
      produce((draft: AgentSkillsState) => {
        delete draft.agentSkillDetailMap[id];
      }),
      false,
      n('deleteAgentSkill'),
    );

    await get().refreshAgentSkills();
  },

  fetchAgentSkillDetail: async (id) => {
    const cached = get().agentSkillDetailMap[id];
    if (cached) return cached;

    const detail = await agentSkillService.getById(id);
    if (detail) {
      set(
        produce((draft: AgentSkillsState) => {
          draft.agentSkillDetailMap[id] = detail;
        }),
        false,
        n('fetchAgentSkillDetail'),
      );
    }
    return detail;
  },

  importAgentSkillFromGitHub: async (params) => {
    const result = await agentSkillService.importFromGitHub(params);
    await get().refreshAgentSkills();
    return result;
  },

  importAgentSkillFromUrl: async (params) => {
    const result = await agentSkillService.importFromUrl(params);
    await get().refreshAgentSkills();
    return result;
  },

  importAgentSkillFromZip: async (params) => {
    const result = await agentSkillService.importFromZip(params);
    await get().refreshAgentSkills();
    return result;
  },

  refreshAgentSkills: async () => {
    const { data } = await agentSkillService.list();
    set({ agentSkills: data }, false, n('refreshAgentSkills'));
  },

  updateAgentSkill: async (params) => {
    const result = await agentSkillService.updateSkill(params);

    // Update detail map if cached
    if (result) {
      set(
        produce((draft: AgentSkillsState) => {
          draft.agentSkillDetailMap[params.id] = result;
        }),
        false,
        n('updateAgentSkill'),
      );
    }

    await get().refreshAgentSkills();
    return result;
  },

  useFetchAgentSkillDetail: (skillId) =>
    useClientDataSWR<AgentSkillDetailData>(
      skillId ? ['fetchAgentSkillDetail', skillId].join('-') : null,
      async () => {
        const [detail, resourceTree] = await Promise.all([
          agentSkillService.getById(skillId!),
          agentSkillService.listResources(skillId!, true),
        ]);

        if (detail) {
          set(
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
    ),

  useFetchAgentSkills: (enabled) =>
    useSWR<SkillListItem[]>(
      enabled ? 'fetchAgentSkills' : null,
      async () => {
        const { data } = await agentSkillService.list();
        return data;
      },
      {
        fallbackData: [],
        onSuccess: (data) => {
          set({ agentSkills: data }, false, n('useFetchAgentSkills'));
        },
        revalidateOnFocus: false,
      },
    ),
});
