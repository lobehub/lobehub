import { FilePenIcon } from 'lucide-react';

import { type DynamicRouteMeta, routeMeta } from '@/spa/router/routeMeta';
import { usePageStore } from '@/store/page';
import { listSelectors } from '@/store/page/slices/list/selectors';
import { getIdFromIdentifier } from '@/utils/identifier';

export const pageRouteMeta = routeMeta({
  icon: FilePenIcon,
  titleKey: 'navigation.page',
  useDynamicMeta: (params): DynamicRouteMeta => {
    const pageId = params.id ? getIdFromIdentifier(params.id, 'docs') : '';
    const document = usePageStore(listSelectors.getDocumentById(pageId));

    return {
      title: document?.title || undefined,
    };
  },
});
