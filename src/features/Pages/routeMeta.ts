import { FilePenIcon } from 'lucide-react';

import { matchesRouteWorkspace, useRouteWorkspaceId } from '@/features/RouteMeta/workspaceScope';
import { type DynamicRouteMeta, routeMeta } from '@/spa/router/routeMeta';
import { usePageStore } from '@/store/page';
import { listSelectors } from '@/store/page/slices/list/selectors';
import { getIdFromIdentifier } from '@/utils/identifier';

export const pageRouteMeta = routeMeta({
  icon: FilePenIcon,
  titleKey: 'navigation.page',
  useDynamicMeta: (params): DynamicRouteMeta => {
    const routeWorkspaceId = useRouteWorkspaceId(params);
    const pageId = params.id ? getIdFromIdentifier(params.id, 'docs') : '';
    const document = usePageStore((s) => {
      const item = listSelectors.getDocumentById(pageId)(s);
      return matchesRouteWorkspace(item?.workspaceId, routeWorkspaceId) ? item : undefined;
    });

    return {
      title: document?.title || undefined,
    };
  },
});
