import dayjs from 'dayjs';
import { useEffect, useRef } from 'react';

import { briefKeys } from '@/libs/swr/keys';
import { getCacheScope } from '@/libs/swr/useCacheScope';
import { getProjectionStoreState, nextProjectionObservedAt, useBriefNews } from '@/projection';
import { briefNewsProjectionQuery } from '@/projection/modules/brief/queries';
import { useProjectionRequest } from '@/projection/query/hook';
import { briefService } from '@/services/brief';
import { taskService } from '@/services/task';
import { type BriefStore } from '@/store/brief/store';
import { type StoreSetter } from '@/store/types';

type Setter = StoreSetter<BriefStore>;

export const createBriefListSlice = (set: Setter, get: () => BriefStore, _api?: unknown) =>
  new BriefListActionImpl(set, get, _api);

export class BriefListActionImpl {
  constructor(_set: Setter, _get: () => BriefStore, _api?: unknown) {
    void _set;
    void _get;
    void _api;
  }

  deleteBrief = async (id: string) => {
    const scope = getCacheScope();
    await briefService.delete(id);
    const observedAt = nextProjectionObservedAt();
    getProjectionStoreState().deleteBriefProjection(scope, id, observedAt);
  };

  markBriefRead = async (id: string) => {
    const scope = getCacheScope();
    const result = await briefService.markRead(id);
    const observedAt = nextProjectionObservedAt();
    const readAt = result.data.readAt ?? new Date().toISOString();
    getProjectionStoreState().updateBriefReadState(scope, id, readAt, observedAt);
  };

  /**
   * "Mark all read" resolves news briefs with the neutral `read` action and drops
   * them from the canonical Home index.
   */
  resolveBriefsAsRead = async (ids: string[]) => {
    if (ids.length === 0) return;

    // Capture the scope these ids belong to *before* awaiting — a workspace
    // switch mid-request must not land the resolution in the next partition.
    const scope = getCacheScope();
    const result = await briefService.resolveManyAsRead(ids);
    const resolvedIds = new Set(result.data);
    if (resolvedIds.size === 0) return;
    const observedAt = nextProjectionObservedAt();

    getProjectionStoreState().resolveBriefProjectionsAsRead(
      scope,
      [...resolvedIds],
      new Date().toISOString(),
      observedAt,
    );
  };

  resolveBrief = async (id: string, action?: string, comment?: string) => {
    const scope = getCacheScope();
    const result = await briefService.resolve(id, { action, comment });
    const observedAt = nextProjectionObservedAt();
    const resolvedAction = result.data.resolvedAction ?? action ?? null;
    const resolvedAt = result.data.resolvedAt ?? new Date().toISOString();
    const resolvedComment = result.data.resolvedComment ?? comment ?? null;
    getProjectionStoreState().updateBriefResolution(
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

  /**
   * Day-scoped news digest (`insight` + `result`, resolved included). SWR owns
   * request orchestration while Projection owns rows, day membership, and the
   * Electron warm cache. `day` is the viewer's local `YYYY-MM-DD`; the
   * [start, end) instants are computed here so the server stays timezone-agnostic.
   * `keepPreviousData` keeps the section stable while the user pages between days.
   */
  useFetchNewsByDay = (enabled: boolean, scope: string, day: string) => {
    const projection = useBriefNews(day);
    const startAt = dayjs(day).startOf('day');
    const request = useProjectionRequest(
      enabled ? briefKeys.news(true, scope, day) : null,
      briefNewsProjectionQuery,
      {
        day,
        endAt: startAt.add(1, 'day').toDate(),
        startAt: startAt.toDate(),
      },
      {
        keepPreviousData: true,
        scope,
      },
    );
    const retainedProjectionRef = useRef<
      { data: NonNullable<typeof projection>; scope: string } | undefined
    >(undefined);
    useEffect(() => {
      if (projection) retainedProjectionRef.current = { data: projection, scope };
    }, [projection, scope]);
    const retainedProjection =
      retainedProjectionRef.current?.scope === scope
        ? retainedProjectionRef.current.data
        : undefined;
    return { ...request, data: projection ?? retainedProjection };
  };
}

export type BriefListAction = Pick<BriefListActionImpl, keyof BriefListActionImpl>;
