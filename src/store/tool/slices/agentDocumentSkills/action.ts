import { buildAgentSkillIdentifier } from '@lobechat/const';
import useSWR, { type SWRResponse } from 'swr';

import {
  type AgentDocumentListItem,
  agentDocumentService,
  agentDocumentSWRKeys,
} from '@/services/agentDocument';
import { type StoreSetter } from '@/store/types';
import { setNamespace } from '@/utils/storeDebug';

import { type ToolStore } from '../../store';
import { type AgentDocumentSkillItem, type AgentDocumentSkillsState } from './initialState';

const n = setNamespace('agentDocumentSkills');

type Setter = StoreSetter<ToolStore>;

const mapDocsToSkills = (docs: AgentDocumentListItem[]): AgentDocumentSkillItem[] =>
  docs
    .filter((doc) => doc.isSkillBundle)
    .map((doc) => ({
      description: doc.description ?? undefined,
      documentId: doc.documentId,
      identifier: buildAgentSkillIdentifier(doc.filename),
      name: doc.filename,
      title: doc.title || undefined,
    }));

export const createAgentDocumentSkillsSlice = (set: Setter, get: () => ToolStore, _api?: unknown) =>
  new AgentDocumentSkillsActionImpl(set, get, _api);

export class AgentDocumentSkillsActionImpl {
  readonly #get: () => ToolStore;
  readonly #set: Setter;

  constructor(set: Setter, get: () => ToolStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
  }

  /**
   * Load (or refresh) the agent-document skill bundles for the given agent and
   * publish them to the tool store registry. Cleared first when switching
   * agents so consumers never see stale items from the previous agent.
   */
  refreshAgentDocumentSkills = async (agentId: string): Promise<void> => {
    const previousAgentId = this.#get().agentDocumentSkillsAgentId;
    if (previousAgentId && previousAgentId !== agentId) {
      this.#set(
        { agentDocumentSkills: [], agentDocumentSkillsAgentId: agentId },
        false,
        n('switchAgent'),
      );
    } else if (!previousAgentId) {
      this.#set({ agentDocumentSkillsAgentId: agentId }, false, n('initAgent'));
    }

    try {
      const docs = await agentDocumentService.listDocuments({ agentId, excludeWeb: true });
      const items = mapDocsToSkills(docs);
      this.#set(
        { agentDocumentSkills: items, agentDocumentSkillsAgentId: agentId },
        false,
        n('refreshAgentDocumentSkills'),
      );
    } catch (error) {
      // Surface registry as empty on failure rather than throwing — slash menu
      // and drag chips degrade gracefully (just nothing to drag) instead of
      // crashing the working sidebar.

      console.warn('[agentDocumentSkills] failed to refresh:', error);
      this.#set(
        { agentDocumentSkills: [] } satisfies Partial<AgentDocumentSkillsState>,
        false,
        n('refreshAgentDocumentSkillsError'),
      );
    }
  };

  clearAgentDocumentSkills = (): void => {
    this.#set(
      { agentDocumentSkills: [], agentDocumentSkillsAgentId: undefined },
      false,
      n('clearAgentDocumentSkills'),
    );
  };

  /**
   * SWR-backed hook that fetches the agent's skill bundles and keeps the store
   * in sync. Fetches the `non-web` variant (drops the unbounded web-clip docs it
   * never needs) so this eager, always-mounted slash-menu hook doesn't pull the
   * full document list into the homepage batch. The working-sidebar panel keeps
   * its own full-list fetch; both revalidate together via the shared
   * `agent:documentsList` prefix (see `invalidateDocumentMutation`).
   */
  useFetchAgentDocumentSkills = (
    agentId: string | undefined,
  ): SWRResponse<AgentDocumentListItem[]> =>
    useSWR<AgentDocumentListItem[]>(
      agentId ? agentDocumentSWRKeys.documentsNonWebList(agentId) : null,
      async () => agentDocumentService.listDocuments({ agentId: agentId!, excludeWeb: true }),
      {
        onSuccess: (docs) => {
          if (!agentId) return;
          this.#set(
            {
              agentDocumentSkills: mapDocsToSkills(docs),
              agentDocumentSkillsAgentId: agentId,
            },
            false,
            n('useFetchAgentDocumentSkills'),
          );
        },
        revalidateOnFocus: false,
      },
    );
}

export type AgentDocumentSkillsAction = Pick<
  AgentDocumentSkillsActionImpl,
  keyof AgentDocumentSkillsActionImpl
>;
