import { FileTextIcon } from 'lucide-react';

import { matchesRouteWorkspace, useRouteWorkspaceId } from '@/features/RouteMeta/workspaceScope';
import { useClientDataSWR } from '@/libs/swr';
import { portalKeys } from '@/libs/swr/keys';
import { documentService } from '@/services/document';
import { type DynamicRouteMeta, routeMeta } from '@/spa/router/routeMeta';
import { getIdFromIdentifier } from '@/utils/identifier';

export const agentDocumentRouteMeta = routeMeta({
  icon: FileTextIcon,
  titleKey: 'navigation.document',
  useDynamicMeta: (params): DynamicRouteMeta => {
    const routeWorkspaceId = useRouteWorkspaceId(params);
    const documentId = params.docId ? getIdFromIdentifier(params.docId, 'docs') : '';
    // Deduped against the Document Header's SWR fetch (same key), so this adds
    // no extra request — it just surfaces the title into the breadcrumb.
    const { data } = useClientDataSWR(
      documentId ? portalKeys.documentHeader(documentId) : null,
      () => documentService.getDocumentById(documentId),
    );
    const document = matchesRouteWorkspace(data?.workspaceId, routeWorkspaceId) ? data : undefined;

    return { title: document?.filename || document?.title || undefined };
  },
});
