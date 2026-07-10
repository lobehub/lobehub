import { ClipboardCheckIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { usePublishDynamicRouteMeta } from '@/features/RouteMeta/usePublishDynamicRouteMeta';
import type { DynamicRouteMetaProps } from '@/spa/router/routeMeta';
import { routeMeta } from '@/spa/router/routeMeta';

import { useVerifyReportBundle } from './hooks';

const VerifyDynamicMeta = ({ onResolve, params }: DynamicRouteMetaProps) => {
  const { t } = useTranslation('verify');
  const { data } = useVerifyReportBundle(params.runId ?? null);

  usePublishDynamicRouteMeta(
    {
      title: data?.run.title || t('report.titleFallback'),
    },
    onResolve,
  );

  return null;
};

/**
 * Standalone verification-report route (`/verify/:runId`). Drives the browser
 * tab / desktop tab title off the report title via the shared route-meta layer,
 * so we don't hand-roll `document.title`.
 */
export const verifyRouteMeta = routeMeta({
  DynamicMeta: VerifyDynamicMeta,
  icon: ClipboardCheckIcon,
});

export const verifyReportsRouteMeta = routeMeta({
  icon: ClipboardCheckIcon,
  titleKey: 'navigation.verifyReports',
});
