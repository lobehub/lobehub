import { FilePenIcon } from 'lucide-react';

import { usePublishDynamicRouteMeta } from '@/features/RouteMeta/usePublishDynamicRouteMeta';
import { matchesRouteWorkspace, useRouteWorkspaceId } from '@/features/RouteMeta/workspaceScope';
import type { DynamicRouteMetaProps } from '@/spa/router/routeMeta';
import { routeMeta } from '@/spa/router/routeMeta';
import { usePageStore } from '@/store/page';
import { listSelectors } from '@/store/page/slices/list/selectors';
import { getIdFromIdentifier } from '@/utils/identifier';

const PageDynamicMeta = ({ onResolve, params }: DynamicRouteMetaProps) => {
  const routeWorkspaceId = useRouteWorkspaceId(params);
  const pageId = params.id ? getIdFromIdentifier(params.id, 'docs') : '';
  const document = usePageStore((s) => {
    const item = listSelectors.getDocumentById(pageId)(s);
    return matchesRouteWorkspace(item?.workspaceId, routeWorkspaceId) ? item : undefined;
  });

  usePublishDynamicRouteMeta(
    {
      title: document?.title || undefined,
    },
    onResolve,
  );

  return null;
};

export const pageRouteMeta = routeMeta({
  DynamicMeta: PageDynamicMeta,
  icon: FilePenIcon,
  titleKey: 'navigation.page',
});
