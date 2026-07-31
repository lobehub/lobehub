import { getClientDataStoreState } from '@/client-data';
import { getCacheScope } from '@/libs/swr/useCacheScope';
import { briefService } from '@/services/brief';
import { taskService } from '@/services/task';
import { type BriefStore } from '@/store/brief/store';
import { type BriefItem } from '@/store/brief/types';
import { type StoreSetter } from '@/store/types';
import { setNamespace } from '@/utils/storeDebug';

const n = setNamespace('briefList');

type Setter = StoreSetter<BriefStore>;

export const createBriefListSlice = (set: Setter, get: () => BriefStore, _api?: unknown) =>
  new BriefListActionImpl(set, get, _api);

export class BriefListActionImpl {
  readonly #get: () => BriefStore;
  readonly #set: Setter;

  constructor(set: Setter, get: () => BriefStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
  }

  internal_updateBrief = (id: string, data: Partial<BriefItem>) => {
    const briefs = this.#get().briefs;
    const index = briefs.findIndex((b) => b.id === id);
    if (index === -1) return;

    const updated = [...briefs];
    updated[index] = { ...briefs[index], ...data };
    this.#set({ briefs: updated }, false, n('internal_updateBrief'));
  };

  deleteBrief = async (id: string) => {
    const scope = getCacheScope();
    const observedAt = Date.now();
    await briefService.delete(id);
    const briefs = this.#get().briefs.filter((b) => b.id !== id);
    this.#set({ briefs }, false, n('deleteBrief'));
    getClientDataStoreState().deleteBriefEntity(scope, id, observedAt);
  };

  markBriefRead = async (id: string) => {
    const scope = getCacheScope();
    const observedAt = Date.now();
    const result = await briefService.markRead(id);
    const readAt = result.data.readAt ?? new Date().toISOString();
    this.internal_updateBrief(id, { readAt });
    getClientDataStoreState().updateBriefReadState(scope, id, readAt, observedAt);
  };

  /**
   * "Mark all read" resolves news briefs with the neutral `read` action and drops
   * them from both the legacy Zustand projection and the canonical Home index.
   */
  resolveBriefsAsRead = async (ids: string[]) => {
    if (ids.length === 0) return;

    const scope = getCacheScope();
    const observedAt = Date.now();
    const result = await briefService.resolveManyAsRead(ids);
    const resolvedIds = new Set(result.data);
    if (resolvedIds.size === 0) return;

    const briefs = this.#get().briefs.filter((b) => !resolvedIds.has(b.id));
    this.#set({ briefs }, false, n('resolveBriefsAsRead'));
    getClientDataStoreState().resolveBriefEntitiesAsRead(
      scope,
      [...resolvedIds],
      new Date().toISOString(),
      observedAt,
    );
  };

  resolveBrief = async (id: string, action?: string, comment?: string) => {
    const scope = getCacheScope();
    const observedAt = Date.now();
    const result = await briefService.resolve(id, { action, comment });
    const resolvedAction = result.data.resolvedAction ?? action ?? null;
    const resolvedAt = result.data.resolvedAt ?? new Date().toISOString();
    const resolvedComment = result.data.resolvedComment ?? comment ?? null;
    this.internal_updateBrief(id, {
      resolvedAction,
      resolvedAt,
      resolvedComment,
    });
    getClientDataStoreState().updateBriefResolution(
      scope,
      id,
      {
        resolvedAction,
        resolvedAt,
        resolvedComment,
      },
      observedAt,
    );
  };

  // Free-form feedback from the brief card: resolve the brief with the
  // user's text (so the heartbeat re-arm gate in TaskLifecycle no longer
  // sees an unresolved urgent brief), then re-run the task so the agent
  // picks up `resolvedComment` in its next prompt. Without this, the brief
  // stays unresolved and the task is parked forever in `human-waiting`.
  submitFeedback = async (briefId: string, taskId: string, content: string) => {
    await this.resolveBrief(briefId, 'feedback', content);
    try {
      await taskService.run(taskId);
    } catch (error) {
      // CONFLICT means a run is already in flight (e.g. the user resolved
      // multiple briefs at once) — the in-flight run will read the freshly
      // resolved comment, so the resolve still does its job.
      console.warn('[BriefStore] submitFeedback: task.run failed', error);
    }
  };
}

export type BriefListAction = Pick<BriefListActionImpl, keyof BriefListActionImpl>;
