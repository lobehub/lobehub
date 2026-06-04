import { CUSTOM_DOCUMENT_FILE_TYPE } from '@lobechat/const';
import { t } from 'i18next';
import { FilePenIcon } from 'lucide-react';

import { type DynamicRouteMeta, routeMeta } from '@/spa/router/routeMeta';
import { usePageStore } from '@/store/page';
import { listSelectors } from '@/store/page/slices/list/selectors';
import { DocumentSourceType, type LobeDocument } from '@/types/document';
import { getIdFromIdentifier } from '@/utils/identifier';

const EDITOR_PAGE_FILE_TYPE = CUSTOM_DOCUMENT_FILE_TYPE;

export const pageRouteMeta = routeMeta({
  createNewTab: () => ({
    onCreate: async () => {
      const untitled = t('pageList.untitled', { ns: 'file' });
      const pageStore = usePageStore.getState();

      const newPage = await pageStore.createPage({ content: '', title: untitled });

      const now = new Date();
      const document: LobeDocument = {
        content: newPage.content || '',
        createdAt: newPage.createdAt ? new Date(newPage.createdAt) : now,
        editorData:
          typeof newPage.editorData === 'string'
            ? (() => {
                try {
                  return JSON.parse(newPage.editorData);
                } catch {
                  return null;
                }
              })()
            : newPage.editorData || null,
        fileType: newPage.fileType || EDITOR_PAGE_FILE_TYPE,
        filename: newPage.title || untitled,
        id: newPage.id,
        metadata: newPage.metadata || {},
        source: 'document',
        sourceType: DocumentSourceType.EDITOR,
        title: newPage.title || untitled,
        totalCharCount: (newPage.content || '').length,
        totalLineCount: 0,
        updatedAt: newPage.updatedAt ? new Date(newPage.updatedAt) : now,
      };

      pageStore.internal_dispatchDocuments({ document, type: 'addDocument' });
      usePageStore.setState({ selectedPageId: newPage.id }, false, 'TabBar/newPage');

      return {
        cached: { title: document.title || untitled },
        url: `/page/${newPage.id}`,
      };
    },
  }),
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
