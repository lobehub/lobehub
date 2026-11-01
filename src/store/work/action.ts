import type { WorkListItem, WorkVersionItem } from '@lobechat/types';
import type { ReplicaSyncOptions } from 'local-replica/zustand';

import type { ReplicaSyncResult } from '@/libs/replica';
import type { StoreSetter } from '@/store/types';
import { setNamespace } from '@/utils/storeDebug';

import { initialWorkState, type WorkState } from './initialState';
import { WorkPrivateAction } from './privateAction';
import {
  type AgentWorksParams,
  type ConversationWorksParams,
  workspaceWorksKey,
  type WorkspaceWorksParams,
  type WorkVersionsParams,
} from './projection';
import { useWorkStore } from './store';

const n = setNamespace('work');

type Setter = StoreSetter<WorkState>;

/**
 * Work lists the UI paints from a local copy: the workspace gallery, the
 * project dashboard's latest works, and the working sidebar's history and
 * version timelines. Each is a replica (first frame from storage, the network
 * confirms); Work mutations keep revalidating them through the `work:` sync
 * keys (`workService.refresh*`).
 */
export class WorkActionImpl {
  readonly #get: () => WorkState;
  readonly #private: WorkPrivateAction;
  readonly #set: Setter;

  constructor(set: Setter, get: () => WorkState, privateAction: WorkPrivateAction) {
    this.#get = get;
    this.#set = set;
    this.#private = privateAction;
  }

  /** Back to a filter's head page, e.g. when the gallery switches to it again. */
  collapseWorkspaceWorks = (params: WorkspaceWorksParams): void => {
    this.#private.workspaceWorks.collapse(workspaceWorksKey(params));
  };

  /**
   * Before a Work change refreshes the `work:` sync keys: drop every gallery
   * filter's loaded tail pages. Only the head page is re-requested, and a tail
   * kept behind an unchanged head would go on showing a Work as it was (e.g. a
   * card whose document was just deleted). The tail loads again on scroll.
   */
  collapseWorkspaceWorksTails = (): void => {
    for (const [key, data] of Object.entries(this.#get().workspaceWorksMap)) {
      if (data.currentPage > 0) this.#private.workspaceWorks.collapse(key);
    }
  };

  loadMoreWorkspaceWorks = async (params: WorkspaceWorksParams): Promise<void> => {
    await this.#private.workspaceWorks.loadMore(workspaceWorksKey(params), params);
  };

  /** Seed a gallery filter from storage before its route paints (route loaders). */
  preHydrateWorkspaceWorks = (params: WorkspaceWorksParams): Promise<boolean> =>
    this.#private.preHydrateWorkspaceWorks(params);

  /**
   * A deleted Work card leaves every list that showed it — including the
   * persisted rows of lists not on screen, so a reload cannot paint it again.
   */
  removeWork = (id: string): void => {
    this.#private.works.remove(id);
    this.#private.versions.remove(id);
  };

  reset = (): void => {
    this.#set(initialWorkState, false, n('reset'));
  };

  useFetchAgentWorks = (params: AgentWorksParams | null): ReplicaSyncResult =>
    this.#private.agentWorks.useSync(params);

  useFetchConversationWorks = (
    params: ConversationWorksParams | null,
    options?: ReplicaSyncOptions<WorkListItem[], WorkListItem[]>,
  ): ReplicaSyncResult => this.#private.conversationWorks.useSync(params, options);

  useFetchWorkVersions = (
    params: WorkVersionsParams | null,
    options?: ReplicaSyncOptions<WorkVersionItem[], WorkVersionItem[]>,
  ): ReplicaSyncResult => this.#private.versions.useSync(params, options);

  useFetchWorkspaceWorks = (params: WorkspaceWorksParams | null): ReplicaSyncResult =>
    this.#private.workspaceWorks.useSync(params);
}

const { getState, setState } = useWorkStore;

export const workActions = new WorkActionImpl(
  setState,
  getState,
  new WorkPrivateAction(setState, getState),
);
