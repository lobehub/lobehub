import { usePublishDynamicRouteMeta } from '@/features/RouteMeta/usePublishDynamicRouteMeta';
import type { DynamicRouteMetaProps, RouteMetaParams } from '@/spa/router/routeMeta';
import { documentSelectors, useFileStore } from '@/store/file';
import { knowledgeBaseSelectors, useKnowledgeBaseStore } from '@/store/library';
import { pageSelectors, usePageStore } from '@/store/page';
import { getIdFromIdentifier } from '@/utils/identifier';

/**
 * The title of a page or file opened in Docs. Reads the stores the opened view
 * already fills (the document replica, the sidebar's page rows, the file
 * detail replica), so resolving it adds no request.
 */
const useResourceItemTitle = (itemId: string | undefined): string | undefined => {
  const documentTitle = useFileStore((s) => documentSelectors.getDocumentById(itemId)(s)?.title);
  const pageTitle = usePageStore((s) => pageSelectors.getDocumentById(itemId)(s)?.title);
  const fileName = useFileStore((s) => (itemId ? s.fileDetailMap[itemId]?.file?.name : undefined));

  return documentTitle || pageTitle || fileName || undefined;
};

/** A page or file opened over the Docs home: `/resource/{page,file}/:id`. */
export const useDocsItemTitle = (params: RouteMetaParams): string | undefined =>
  // Page paths drop the `docs_` prefix; file paths carry the full id.
  useResourceItemTitle(params.id ? getIdFromIdentifier(params.id, 'docs') : undefined);

export const DocsItemDynamicMeta = ({ onResolve, params }: DynamicRouteMetaProps) => {
  usePublishDynamicRouteMeta({ title: useDocsItemTitle(params) }, onResolve);

  return null;
};

/**
 * Anywhere inside a library (`/resource/library/:id/...`): the opened page or
 * file, else the opened folder, else the library itself.
 */
export const useLibraryTitle = (params: RouteMetaParams): string | undefined => {
  const libraryName = useKnowledgeBaseStore(
    knowledgeBaseSelectors.getKnowledgeBaseNameById(params.id ?? ''),
  );
  // The chain ends at the folder itself.
  const folderName = useFileStore((s) =>
    params.folderId ? s.folderBreadcrumbMap[params.folderId]?.at(-1)?.name : undefined,
  );
  const itemTitle = useResourceItemTitle(params.itemId);

  return itemTitle || folderName || libraryName || undefined;
};

export const LibraryDynamicMeta = ({ onResolve, params }: DynamicRouteMetaProps) => {
  usePublishDynamicRouteMeta({ title: useLibraryTitle(params) }, onResolve);

  return null;
};
