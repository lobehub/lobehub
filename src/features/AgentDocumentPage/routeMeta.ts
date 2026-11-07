import { FileTextIcon } from 'lucide-react';

import { createSurfaceSkeleton } from '@/components/Skeleton/Surface';
import { usePublishDynamicRouteMeta } from '@/features/RouteMeta/usePublishDynamicRouteMeta';
import { matchesRouteWorkspace, useRouteWorkspaceId } from '@/features/RouteMeta/workspaceScope';
import type { DynamicRouteMetaProps } from '@/spa/router/routeMeta';
import { routeMeta } from '@/spa/router/routeMeta';
import { useDocumentStore } from '@/store/document';
import { getIdFromIdentifier } from '@/utils/identifier';

const AgentDocumentDynamicMeta = ({ onResolve, params }: DynamicRouteMetaProps) => {
  const routeWorkspaceId = useRouteWorkspaceId(params);
  const documentId = params.docId ? getIdFromIdentifier(params.docId, 'docs') : '';
  // Shares the document's replica entry with the page and portal views, so this
  // adds no extra request and a reload paints the persisted title right away.
  const useFetchDocumentDetail = useDocumentStore((s) => s.useFetchDocumentDetail);
  const { data } = useFetchDocumentDetail(documentId || undefined);
  const document = matchesRouteWorkspace(data?.workspaceId, routeWorkspaceId) ? data : undefined;

  usePublishDynamicRouteMeta(
    { title: document?.filename || document?.title || undefined },
    onResolve,
  );

  return null;
};

export const agentDocumentRouteMeta = routeMeta({
  DynamicMeta: AgentDocumentDynamicMeta,
  icon: FileTextIcon,
  Skeleton: createSurfaceSkeleton('editor'),
  titleKey: 'navigation.document',
});
