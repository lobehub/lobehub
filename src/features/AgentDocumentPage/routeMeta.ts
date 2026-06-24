import { FileTextIcon } from 'lucide-react';

import { usePublishDynamicRouteMeta } from '@/features/RouteMeta/usePublishDynamicRouteMeta';
import { matchesRouteWorkspace, useRouteWorkspaceId } from '@/features/RouteMeta/workspaceScope';
import { useClientDataSWR } from '@/libs/swr';
import { portalKeys } from '@/libs/swr/keys';
import { documentService } from '@/services/document';
import type { DynamicRouteMetaProps } from '@/spa/router/routeMeta';
import { routeMeta } from '@/spa/router/routeMeta';
import { getIdFromIdentifier } from '@/utils/identifier';

const AgentDocumentDynamicMeta = ({ onResolve, params }: DynamicRouteMetaProps) => {
  const routeWorkspaceId = useRouteWorkspaceId(params);
  const documentId = params.docId ? getIdFromIdentifier(params.docId, 'docs') : '';
  // Deduped against the Document Header's SWR fetch (same key), so this adds
  // no extra request — it just surfaces the title into the breadcrumb.
  const { data } = useClientDataSWR(documentId ? portalKeys.documentHeader(documentId) : null, () =>
    documentService.getDocumentById(documentId),
  );
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
  titleKey: 'navigation.document',
});
