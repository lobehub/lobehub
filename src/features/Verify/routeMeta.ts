import { ClipboardCheckIcon } from 'lucide-react';

import { type DynamicRouteMeta, routeMeta } from '@/spa/router/routeMeta';

import { useVerifyReportBundle } from './hooks';

/**
 * Standalone verification-report route (`/verify/:runId`). Drives the browser
 * tab / desktop tab title off the report title via the shared route-meta layer,
 * so we don't hand-roll `document.title`.
 */
export const verifyRouteMeta = routeMeta({
  icon: ClipboardCheckIcon,
  useDynamicMeta: (params): DynamicRouteMeta => {
    const { data } = useVerifyReportBundle(params.runId ?? null);

    return {
      title: data?.run.title || 'Verification report',
    };
  },
});
