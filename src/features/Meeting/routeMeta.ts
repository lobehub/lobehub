import { NotebookTextIcon } from 'lucide-react';

import { createSurfaceSkeleton } from '@/components/Skeleton/Surface';
import { usePublishDynamicRouteMeta } from '@/features/RouteMeta/usePublishDynamicRouteMeta';
import type { DynamicRouteMetaProps } from '@/spa/router/routeMeta';
import { routeMeta } from '@/spa/router/routeMeta';
import { meetingSelectors, useMeetingStore } from '@/store/meeting';

export const meetingsRouteMeta = routeMeta({
  icon: NotebookTextIcon,
  Skeleton: createSurfaceSkeleton('list'),
  titleKey: 'navigation.meetings',
});

const MeetingDynamicMeta = ({ onResolve, params }: DynamicRouteMetaProps) => {
  const title = useMeetingStore(meetingSelectors.meetingTitle(params.meetingId));

  usePublishDynamicRouteMeta({ title: title || undefined }, onResolve);

  return null;
};

export const meetingDetailRouteMeta = routeMeta({
  DynamicMeta: MeetingDynamicMeta,
  icon: NotebookTextIcon,
  Skeleton: createSurfaceSkeleton('detail'),
  titleKey: 'navigation.meetings',
});
