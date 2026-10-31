import type { WorkListItem, WorkSummaryItem, WorkVersionItem } from '@lobechat/types';

import {
  arrayEntity,
  cacheScope,
  createReplicaSlice,
  linkReplicaEntity,
  recordLens,
  type ReplicaPageResult,
} from '@/libs/replica';
import { workService } from '@/services/work';
import type { StoreSetter } from '@/store/types';
import { setNamespace } from '@/utils/storeDebug';

import type { WorkspaceWorksData, WorkState } from './initialState';
import {
  AGENT_WORKS_LIMIT,
  agentWorksResource,
  conversationWorksResource,
  toPersistedVersions,
  WORKSPACE_WORKS_PAGE_SIZE,
  type WorkspaceWorksParams,
  workspaceWorksResource,
  workVersionsResource,
} from './projection';

const n = setNamespace('work');

type Setter = StoreSetter<WorkState>;

const workId = (item: { id: string }) => item.id;

export class WorkPrivateAction {
  readonly agentWorks;
  readonly conversationWorks;
  readonly versions;
  readonly workspaceWorks;
  /** One Work card everywhere it is listed: gallery, project dashboard, sidebar history. */
  readonly works;

  constructor(set: Setter, get: () => WorkState) {
    this.workspaceWorks = createReplicaSlice(workspaceWorksResource, {
      actionPrefix: n('workspaceWorks'),
      fetcher: this.#fetchWorkspacePage,
      get,
      set,
      stateKey: 'workspaceWorksReplica',
      view: recordLens<WorkState, WorkspaceWorksData>('workspaceWorksMap'),
    });
    this.agentWorks = createReplicaSlice(agentWorksResource, {
      actionPrefix: n('agentWorks'),
      entity: arrayEntity<WorkSummaryItem>(workId),
      fetcher: async ({ originAgentId }) => {
        const { items } = await workService.listByWorkspace({
          limit: AGENT_WORKS_LIMIT,
          originAgentId,
        });
        return items;
      },
      get,
      set,
      stateKey: 'agentWorksReplica',
      view: recordLens<WorkState, WorkSummaryItem[]>('agentWorksMap'),
    });
    this.conversationWorks = createReplicaSlice(conversationWorksResource, {
      actionPrefix: n('conversationWorks'),
      entity: arrayEntity<WorkListItem>(workId),
      fetcher: ({ threadId, topicId }) => workService.listByConversation({ threadId, topicId }),
      get,
      set,
      stateKey: 'conversationWorksReplica',
      view: recordLens<WorkState, WorkListItem[]>('conversationWorksMap'),
    });
    this.versions = createReplicaSlice(workVersionsResource, {
      actionPrefix: n('versions'),
      fetcher: ({ workId }) => workService.listVersions(workId),
      get,
      set,
      stateKey: 'workVersionsReplica',
      toPersisted: toPersistedVersions,
      view: recordLens<WorkState, WorkVersionItem[]>('workVersionsMap'),
    });
    this.works = linkReplicaEntity<WorkSummaryItem | WorkListItem>([
      this.workspaceWorks,
      this.agentWorks,
      this.conversationWorks,
    ]);
  }

  /** One gallery page: `cursor` undefined = the head (newest first). */
  #fetchWorkspacePage = async (
    { provider, type, visibility }: WorkspaceWorksParams,
    cursor?: string,
  ): Promise<ReplicaPageResult<WorkSummaryItem, string>> => {
    const { items, nextCursor } = await workService.listByWorkspace({
      cursor,
      limit: WORKSPACE_WORKS_PAGE_SIZE,
      provider,
      type: type ?? null,
      visibility,
    });
    return { items, nextCursor };
  };

  /** Seed a gallery filter from storage before its route paints. */
  preHydrateWorkspaceWorks = (params: WorkspaceWorksParams): Promise<boolean> => {
    const scope = cacheScope.get();
    // The slot may still hold the previous identity's rows; drop them before seeding.
    this.workspaceWorks.ensureScope(scope);
    return this.workspaceWorks.hydrate(params, scope);
  };
}
