import type { RouteObject } from 'react-router';

import { createSurfaceSkeleton } from '@/components/Skeleton/Surface';
import { routeMeta } from '@/spa/router/routeMeta';
import { dynamicElement, ErrorBoundary } from '@/utils/router';

/**
 * `/eval/*`: the eval workspace (Agent Eval home, benchmark-scoped pages) and
 * Lobe Bench. Mounted in `desktopRouter.shared.tsx` among the main-area routes.
 */
export const evalRoute: RouteObject = {
  children: [
    // Home (overview)
    {
      children: [
        {
          element: dynamicElement(
            () => import('@/routes/(main)/eval'),
            'Desktop > Eval > Overview',
            { preloadId: 'eval' },
          ),
          index: true,
        },
        {
          element: dynamicElement(
            () => import('@/routes/(main)/eval/experiments/[experimentId]'),
            'Desktop > Eval > Experiment Detail',
          ),
          path: 'experiments/:experimentId',
        },
        // A dataset and a case are addressable on their own — a dataset need
        // not belong to a benchmark, so a benchmark id cannot be part of
        // their canonical path. They live in the home group to keep the eval
        // workspace sidebar; the bench group's sidebar is benchmark-scoped
        // and has nothing to show for a dataset that belongs to none.
        {
          element: dynamicElement(
            () => import('@/routes/(main)/eval/datasets/[datasetId]'),
            'Desktop > Eval > Dataset Detail',
          ),
          path: 'datasets/:datasetId',
        },
        {
          element: dynamicElement(
            () => import('@/routes/(main)/eval/cases/[caseId]'),
            'Desktop > Eval > Test Case Detail',
          ),
          path: 'cases/:caseId',
        },
      ],
      element: dynamicElement(
        () => import('@/routes/(main)/eval/(home)/_layout'),
        'Desktop > Eval > Home > Layout',
        { preloadId: 'eval' },
      ),
    },
    // Lobe Bench: LobeHub's standard cases, compared across models
    {
      children: [
        {
          element: dynamicElement(
            () => import('@/routes/(main)/eval/lobe-bench'),
            'Desktop > Eval > Lobe Bench > Overview',
          ),
          index: true,
        },
        {
          element: dynamicElement(
            () => import('@/routes/(main)/eval/lobe-bench/experiments/new'),
            'Desktop > Eval > Lobe Bench > New Experiment',
          ),
          path: 'experiments/new',
        },
        {
          element: dynamicElement(
            () => import('@/routes/(main)/eval/lobe-bench/experiments/[experimentId]'),
            'Desktop > Eval > Lobe Bench > Experiment',
          ),
          path: 'experiments/:experimentId',
        },
        {
          element: dynamicElement(
            () => import('@/routes/(main)/eval/lobe-bench/library'),
            'Desktop > Eval > Lobe Bench > Library',
          ),
          path: 'library',
        },
        {
          element: dynamicElement(
            () => import('@/routes/(main)/eval/lobe-bench/environments'),
            'Desktop > Eval > Lobe Bench > Environments',
          ),
          path: 'environments',
        },
        {
          element: dynamicElement(
            () => import('@/routes/(main)/eval/lobe-bench/contenders'),
            'Desktop > Eval > Lobe Bench > Contenders',
          ),
          path: 'contenders',
        },
        {
          element: dynamicElement(
            () => import('@/routes/(main)/eval/lobe-bench/settings'),
            'Desktop > Eval > Lobe Bench > Settings',
          ),
          path: 'settings',
        },
        {
          element: dynamicElement(
            () => import('@/routes/(main)/eval/lobe-bench/benchmarks/[benchmarkId]'),
            'Desktop > Eval > Lobe Bench > Benchmark',
          ),
          path: 'benchmarks/:benchmarkId',
        },
        {
          element: dynamicElement(
            () => import('@/routes/(main)/eval/lobe-bench/datasets/[datasetId]'),
            'Desktop > Eval > Lobe Bench > Case set',
          ),
          path: 'datasets/:datasetId',
        },
      ],
      element: dynamicElement(
        () => import('@/routes/(main)/eval/lobe-bench/_layout'),
        'Desktop > Eval > Lobe Bench > Layout',
      ),
      path: 'lobe-bench',
    },
    // Bench routes (with dedicated sidebar)
    {
      children: [
        {
          element: dynamicElement(
            () => import('@/routes/(main)/eval/bench/[benchmarkId]'),
            'Desktop > Eval > Benchmark Detail',
          ),
          handle: { meta: routeMeta({ Skeleton: createSurfaceSkeleton('detail') }) },
          index: true,
        },
        {
          children: [
            {
              element: dynamicElement(
                () => import('@/routes/(main)/eval/bench/[benchmarkId]/runs/[runId]'),
                'Desktop > Eval > Run Detail',
              ),
              index: true,
            },
            {
              element: dynamicElement(
                () =>
                  import('@/routes/(main)/eval/bench/[benchmarkId]/runs/[runId]/cases/[caseId]'),
                'Desktop > Eval > Case Detail',
              ),
              path: 'cases/:caseId',
            },
          ],
          path: 'runs/:runId',
        },
        {
          // Legacy shape, kept so existing links still resolve; it redirects
          // to the benchmark-free `/eval/datasets/:datasetId`.
          element: dynamicElement(
            () => import('@/routes/(main)/eval/bench/[benchmarkId]/datasets/[datasetId]'),
            'Desktop > Eval > Dataset Detail (legacy redirect)',
          ),
          path: 'datasets/:datasetId',
        },
      ],
      element: dynamicElement(
        () => import('@/routes/(main)/eval/bench/[benchmarkId]/_layout'),
        'Desktop > Eval > Bench > Layout',
      ),
      path: 'bench/:benchmarkId',
    },
  ],
  element: dynamicElement(() => import('@/routes/(main)/eval/_layout'), 'Desktop > Eval > Layout', {
    preloadId: 'eval',
  }),
  errorElement: <ErrorBoundary />,
  handle: { meta: routeMeta({ Skeleton: createSurfaceSkeleton('list') }) },
  path: 'eval',
};
