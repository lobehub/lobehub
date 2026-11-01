import { ClipboardCheckIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { createSurfaceSkeleton } from '@/components/Skeleton/Surface';
import { usePublishDynamicRouteMeta } from '@/features/RouteMeta/usePublishDynamicRouteMeta';
import type { DynamicRouteMetaProps } from '@/spa/router/routeMeta';
import { routeMeta } from '@/spa/router/routeMeta';

import { useAcceptanceBundle } from './hooks';

// Routes without an `:acceptanceId` (e.g. the `/acceptance` index) must not
// publish the fallback — it would pin every such tab to the same static label.
export const resolveAcceptanceDynamicTitle = (
  subjectTitle: string | null | undefined,
  acceptanceId: string | null | undefined,
  translate: (key: string) => string,
): string | undefined =>
  subjectTitle || (acceptanceId ? translate('acceptance.titleFallback') : undefined);

const AcceptanceDynamicMeta = ({ onResolve, params }: DynamicRouteMetaProps) => {
  const { t } = useTranslation('verify');
  const { data } = useAcceptanceBundle(params.acceptanceId ?? null);
  const translate = t as unknown as (key: string) => string;

  usePublishDynamicRouteMeta(
    {
      title: resolveAcceptanceDynamicTitle(data?.subject.title, params.acceptanceId, translate),
    },
    onResolve,
  );

  return null;
};

export const acceptanceRouteMeta = routeMeta({
  DynamicMeta: AcceptanceDynamicMeta,
  icon: ClipboardCheckIcon,
  Skeleton: createSurfaceSkeleton('detail'),
  titleKey: 'verify:acceptance.titleFallback',
});
