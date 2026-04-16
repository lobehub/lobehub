import isEqual from 'fast-deep-equal';
import { type SWRResponse } from 'swr';

import { useClientDataSWRWithSync } from '@/libs/swr';
import { briefService } from '@/services/brief';
import { type BriefStore } from '@/store/brief/store';
import { type BriefItem } from '@/store/brief/types';
import { type StoreSetter } from '@/store/types';
import { setNamespace } from '@/utils/storeDebug';

const n = setNamespace('briefList');

const FETCH_BRIEFS_KEY = 'fetchBriefs';

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

  addComment = async (briefId: string, taskId: string, content: string) => {
    await briefService.addComment(taskId, content, briefId);
  };

  internal_updateBrief = (id: string, data: Partial<BriefItem>) => {
    const briefs = this.#get().briefs;
    const index = briefs.findIndex((b) => b.id === id);
    if (index === -1) return;

    const updated = [...briefs];
    updated[index] = { ...briefs[index], ...data };
    this.#set({ briefs: updated }, false, n('internal_updateBrief'));
  };

  markBriefRead = async (id: string) => {
    await briefService.markRead(id);
    this.internal_updateBrief(id, { readAt: new Date().toISOString() });
  };

  resolveBrief = async (id: string, action?: string, comment?: string) => {
    await briefService.resolve(id, { action, comment });
    this.internal_updateBrief(id, {
      resolvedAction: action,
      resolvedAt: new Date().toISOString(),
    });
  };

  useFetchBriefs = (isLogin: boolean | undefined): SWRResponse<BriefItem[]> => {
    return useClientDataSWRWithSync<BriefItem[]>(
      isLogin === true ? [FETCH_BRIEFS_KEY, isLogin] : null,
      async () => {
        const result = await briefService.listUnresolved();
        return result.data as BriefItem[];
      },
      {
        onData: (data) => {
          if (this.#get().isBriefsInit && isEqual(this.#get().briefs, data)) return;

          this.#set({ briefs: data, isBriefsInit: true }, false, n('useFetchBriefs/onData'));
        },
      },
    );
  };
}

export type BriefListAction = Pick<BriefListActionImpl, keyof BriefListActionImpl>;
