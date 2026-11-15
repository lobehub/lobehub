/**
 * @vitest-environment happy-dom
 *
 * The verify report, verifier tracing, rubric templates, rubric / Goal criteria
 * and the plan skill under review are replicas persisted to IndexedDB: a reload
 * paints the last confirmed copy before the network answers, then refreshes.
 *
 * Rows are seeded through the storage namespace (`replica:<name>:v1`) and read
 * through the public hooks only, so these assertions run against the SWR
 * implementation they replaced as well.
 */
import { randomUUID } from 'node:crypto';

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { createElement, useEffect } from 'react';
import { SWRConfig, useSWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  useGoalCriteria,
  useRubricCriteria,
  useRubrics,
  useVerifierTracing,
  useVerifyReportBundle,
} from '@/features/Acceptance/hooks';
import {
  usePlanSkill,
  useSkillVersion,
} from '@/features/AgentGoals/ProcessControl/BatchPlan/skillVersions';
import { AppIndexedDBStorage, cacheScope, REPLICA_INDEX_KEY } from '@/libs/replica';
import { setScopedMutate } from '@/libs/swr/mutate';
import { userSkillService } from '@/services/userSkill';
import { verifyService } from '@/services/verify';

import { useVerifyStore } from './index';
import { initialState } from './initialState';

const MutateBridge = () => {
  const { mutate } = useSWRConfig();
  useEffect(() => setScopedMutate(mutate), [mutate]);
  return null;
};

const wrapper = ({ children }: PropsWithChildren) =>
  createElement(
    SWRConfig,
    { value: { provider: () => new Map(), shouldRetryOnError: false } },
    createElement(MutateBridge),
    children,
  );

const storageOf = (name: string) =>
  new AppIndexedDBStorage<unknown>({ namespace: `replica:${name}:v1` });

/** Never-resolving fetch: the first frame can only come from storage. */
const pending = () => new Promise<never>(() => {});

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, reject, resolve };
};

const report = (title: string, status = 'passed') =>
  ({
    isOwner: true,
    report: null,
    results: [],
    run: { id: 'run-1', status, title },
  }) as never;

const rubric = (id: string, title: string) => ({ id, title }) as never;
const criterion = (id: string, title: string) => ({ id, title }) as never;

describe('verify read replicas', () => {
  let scope = '';
  const seeded: { name: string; queryKey: string; scope: string }[] = [];

  const persist = async (name: string, queryKey: string, data: unknown, at = scope) => {
    seeded.push({ name, queryKey, scope: at });
    await storageOf(name).set({ queryKey, scope: at }, { data, updatedAt: 1 });
  };
  const stored = async (name: string, queryKey: string) => {
    seeded.push({ name, queryKey, scope });
    return (await storageOf(name).get({ queryKey, scope }))?.data;
  };

  beforeEach(() => {
    scope = `verify-user-${randomUUID()}:personal`;
    vi.spyOn(cacheScope, 'get').mockImplementation(() => scope);
    vi.spyOn(cacheScope, 'use').mockImplementation(() => scope);
    vi.spyOn(cacheScope, 'canPersist').mockReturnValue(true);
    act(() => useVerifyStore.setState(initialState, false));
  });

  afterEach(async () => {
    cleanup();
    for (const row of seeded.splice(0)) {
      const storage = storageOf(row.name);
      await storage.remove({ queryKey: row.queryKey, scope: row.scope });
      await storage.remove({ queryKey: REPLICA_INDEX_KEY, scope: row.scope });
    }
    vi.restoreAllMocks();
  });

  describe('verify report', () => {
    it('paints a persisted finished report before the network answers, then refreshes it', async () => {
      await persist('verifyReportBundle', 'run-1', { value: report('Saved title') });
      const next = deferred<unknown>();
      vi.spyOn(verifyService, 'getReportBundle').mockImplementation(() => next.promise as never);

      const { result } = renderHook(() => useVerifyReportBundle('run-1'), { wrapper });

      await waitFor(() => expect(result.current.data?.run.title).toBe('Saved title'));
      expect(result.current.isLoading).toBe(false);

      await act(async () => next.resolve(report('Fresh title')));
      await waitFor(() => expect(result.current.data?.run.title).toBe('Fresh title'));
    });

    it('persists a finished report but keeps a running one memory-only', async () => {
      const getReportBundle = vi.spyOn(verifyService, 'getReportBundle');
      getReportBundle.mockResolvedValueOnce(report('Done'));
      renderHook(() => useVerifyReportBundle('run-1'), { wrapper });
      await waitFor(async () =>
        expect(await stored('verifyReportBundle', 'run-1')).toMatchObject({
          value: { run: { title: 'Done' } },
        }),
      );
      cleanup();

      getReportBundle.mockResolvedValueOnce(report('Still going', 'verifying'));
      act(() => useVerifyStore.setState(initialState, false));
      const { result } = renderHook(() => useVerifyReportBundle('run-2'), { wrapper });
      await waitFor(() => expect(result.current.data?.run.status).toBe('verifying'));
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(await stored('verifyReportBundle', 'run-2')).toBeUndefined();
    });

    it('settles a missing run on not found without persisting the answer', async () => {
      vi.spyOn(verifyService, 'getReportBundle').mockResolvedValue(null);

      const { result } = renderHook(() => useVerifyReportBundle('run-gone'), { wrapper });

      await waitFor(() => expect(result.current.data).toBeNull());
      expect(result.current.isLoading).toBe(false);
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(await stored('verifyReportBundle', 'run-gone')).toBeUndefined();
    });

    it('sends one request for the page, title, menu and link reading the same report', async () => {
      const getReportBundle = vi
        .spyOn(verifyService, 'getReportBundle')
        .mockResolvedValue(report('Shared'));

      const { result } = renderHook(
        () => [
          useVerifyReportBundle('run-1'),
          useVerifyReportBundle('run-1'),
          useVerifyReportBundle('run-1'),
          useVerifyReportBundle('run-1'),
        ],
        { wrapper },
      );

      await waitFor(() => expect(result.current[3].data?.run.title).toBe('Shared'));
      expect(getReportBundle).toHaveBeenCalledTimes(1);
    });

    it('keeps the last report on screen when a refresh fails', async () => {
      await persist('verifyReportBundle', 'run-1', { value: report('Saved title') });
      vi.spyOn(verifyService, 'getReportBundle').mockRejectedValue(new Error('network down'));

      const { result } = renderHook(() => useVerifyReportBundle('run-1'), { wrapper });

      await waitFor(() => expect(result.current.error).toBeInstanceOf(Error));
      expect(result.current.data?.run.title).toBe('Saved title');
    });

    it('does not show the previous identity its report after a switch', async () => {
      const previous = scope;
      await persist('verifyReportBundle', 'run-1', { value: report('Theirs') }, previous);
      vi.spyOn(verifyService, 'getReportBundle').mockImplementation(pending);

      const { rerender, result } = renderHook(() => useVerifyReportBundle('run-1'), { wrapper });
      await waitFor(() => expect(result.current.data?.run.title).toBe('Theirs'));

      scope = `verify-user-${randomUUID()}:personal`;
      rerender();

      await waitFor(() => expect(result.current.data).toBeUndefined());
      expect(result.current.isLoading).toBe(true);
    });

    it('renames the run on the report and in its persisted row, and rolls back a rejected rename', async () => {
      const getReportBundle = vi
        .spyOn(verifyService, 'getReportBundle')
        .mockResolvedValue(report('Old'));
      renderHook(() => useVerifyReportBundle('run-1'), { wrapper });
      await waitFor(() =>
        expect(useVerifyStore.getState().verifyReportBundleMap['run-1']?.value?.run.title).toBe(
          'Old',
        ),
      );

      const write = deferred<unknown>();
      vi.spyOn(verifyService, 'updateRunTitle').mockImplementation(() => write.promise as never);
      getReportBundle.mockResolvedValue(report('New'));
      let renaming!: Promise<void>;
      act(() => {
        renaming = useVerifyStore.getState().renameVerifyReportRun('run-1', 'New');
      });
      // Optimistic: the new title is on the report before the server answers.
      expect(useVerifyStore.getState().verifyReportBundleMap['run-1']?.value?.run.title).toBe(
        'New',
      );
      await act(async () => {
        write.resolve(undefined);
        await renaming;
      });
      await waitFor(async () =>
        expect(await stored('verifyReportBundle', 'run-1')).toMatchObject({
          value: { run: { title: 'New' } },
        }),
      );

      vi.spyOn(verifyService, 'updateRunTitle').mockRejectedValue(new Error('denied'));
      await act(async () => {
        await expect(
          useVerifyStore.getState().renameVerifyReportRun('run-1', 'Rejected'),
        ).rejects.toThrow('denied');
      });
      expect(useVerifyStore.getState().verifyReportBundleMap['run-1']?.value?.run.title).toBe(
        'New',
      );
    });
  });

  describe('verifier tracing', () => {
    it('paints a persisted tracing before the network answers', async () => {
      await persist('verifierTracing', 'trace-1', {
        value: { inputTokens: 10, model: 'gpt-x', outputTokens: 5 },
      });
      vi.spyOn(verifyService, 'getVerifierTracing').mockImplementation(pending);

      const { result } = renderHook(() => useVerifierTracing('trace-1'), { wrapper });

      await waitFor(() => expect(result.current.data?.model).toBe('gpt-x'));
    });
  });

  describe('rubric templates', () => {
    it('paints the persisted templates before the network answers, then refreshes them', async () => {
      await persist('verifyRubricList', 'all', [rubric('r1', 'Saved')]);
      const next = deferred<unknown>();
      vi.spyOn(verifyService, 'listRubrics').mockImplementation(() => next.promise as never);

      const { result } = renderHook(() => useRubrics(), { wrapper });

      await waitFor(() => expect(result.current.data?.[0]?.title).toBe('Saved'));
      await act(async () => next.resolve([rubric('r1', 'Fresh')]));
      await waitFor(() => expect(result.current.data?.[0]?.title).toBe('Fresh'));
    });

    it('reads a restored empty list as loading until the server confirms it', async () => {
      await persist('verifyRubricList', 'all', []);
      const next = deferred<unknown>();
      vi.spyOn(verifyService, 'listRubrics').mockImplementation(() => next.promise as never);

      const { result } = renderHook(() => useRubrics(), { wrapper });

      await waitFor(() => expect(useVerifyStore.getState().verifyRubricListMap.all).toEqual([]));
      expect(result.current.data).toBeUndefined();
      expect(result.current.isLoading).toBe(true);

      await act(async () => next.resolve([]));
      await waitFor(() => expect(result.current.data).toEqual([]));
      expect(result.current.isLoading).toBe(false);
    });

    it('does not request templates while rubric authoring is inactive', async () => {
      const listRubrics = vi.spyOn(verifyService, 'listRubrics').mockResolvedValue([]);

      renderHook(() => useRubrics(false), { wrapper });
      await act(() => new Promise((resolve) => setTimeout(resolve, 20)));

      expect(listRubrics).not.toHaveBeenCalled();
    });
  });

  describe('rubric and Goal criteria', () => {
    it('paints the persisted criteria of a rubric before the network answers', async () => {
      await persist('verifyRubricCriteria', 'r1', [criterion('c1', 'Saved')]);
      vi.spyOn(verifyService, 'getRubricCriteria').mockImplementation(pending);

      const { result } = renderHook(() => useRubricCriteria('r1'), { wrapper });

      await waitFor(() => expect(result.current.data?.[0]?.title).toBe('Saved'));
    });

    it('paints a Goal criteria set before the network answers, then refreshes it', async () => {
      await persist('verifyGoalCriteria', 'c1,c2', [
        criterion('c1', 'Saved 1'),
        criterion('c2', 'Saved 2'),
      ]);
      const next = deferred<unknown>();
      const getCriteria = vi
        .spyOn(verifyService, 'getCriteria')
        .mockImplementation(() => next.promise as never);
      const ids = ['c1', 'c2'];

      const { result } = renderHook(() => [useGoalCriteria(ids), useGoalCriteria(ids)], {
        wrapper,
      });

      await waitFor(() => expect(result.current[0].data?.[1]?.title).toBe('Saved 2'));
      await act(async () => next.resolve([criterion('c1', 'Fresh 1'), criterion('c2', 'Fresh 2')]));
      await waitFor(() => expect(result.current[1].data?.[0]?.title).toBe('Fresh 1'));
      // The criteria section and the result page share one request.
      expect(getCriteria).toHaveBeenCalledTimes(1);
      expect(getCriteria).toHaveBeenCalledWith(ids);
    });
  });

  describe('plan skill', () => {
    it('paints the persisted plan skill and its shipped version before the network answers', async () => {
      await persist('planSkill', 'skill-1', {
        value: { files: [{ content: '', path: 'scripts/a.sh' }], id: 'skill-1', versions: [] },
      });
      await persist('skillVersion', 'skill-1@2', { value: { content: '# v2', files: [] } });
      vi.spyOn(userSkillService, 'get').mockImplementation(pending);
      vi.spyOn(userSkillService, 'getVersion').mockImplementation(pending);

      const { result } = renderHook(
        () => ({ skill: usePlanSkill('skill-1'), version: useSkillVersion('skill-1', 2) }),
        { wrapper },
      );

      await waitFor(() => expect(result.current.skill.data?.files).toHaveLength(1));
      await waitFor(() => expect(result.current.version.data?.content).toBe('# v2'));
      expect(result.current.skill.isLoading).toBe(false);
      expect(result.current.version.isLoading).toBe(false);
    });

    it('sends one request for the gate directory and its file toggle', async () => {
      const get = vi
        .spyOn(userSkillService, 'get')
        .mockResolvedValue({ files: [], id: 'skill-1', versions: [] } as never);

      const { result } = renderHook(() => [usePlanSkill('skill-1'), usePlanSkill('skill-1')], {
        wrapper,
      });

      await waitFor(() => expect(result.current[1].data).toBeDefined());
      expect(get).toHaveBeenCalledTimes(1);
    });
  });
});
