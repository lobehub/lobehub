import { FileTextIcon } from 'lucide-react';
import useSWR from 'swr';

import { usePublishDynamicRouteMeta } from '@/features/RouteMeta/usePublishDynamicRouteMeta';
import { shareKeys } from '@/libs/swr/keys';
import { lambdaClient } from '@/libs/trpc/client';
import type { DynamicRouteMetaProps } from '@/spa/router/routeMeta';
import { routeMeta } from '@/spa/router/routeMeta';
import { getIdFromIdentifier } from '@/utils/identifier';

const SharePageDynamicMeta = ({ onResolve, params }: DynamicRouteMetaProps) => {
  const documentId = getIdFromIdentifier(params.id ?? '', 'docs');
  const { data } = useSWR(
    documentId ? shareKeys.pageDocument(documentId) : null,
    () => lambdaClient.pageShare.getSharedDocument.query({ documentId }),
    { revalidateOnFocus: false },
  );

  usePublishDynamicRouteMeta(
    {
      title: data?.document.title || undefined,
    },
    onResolve,
  );

  return null;
};

export const sharePageRouteMeta = routeMeta({
  DynamicMeta: SharePageDynamicMeta,
  icon: FileTextIcon,
  titleKey: 'navigation.pages',
});
