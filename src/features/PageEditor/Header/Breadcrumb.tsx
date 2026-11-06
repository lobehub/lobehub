import { Flexbox } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useFileStore } from '@/store/file';
import { knowledgeBaseSelectors, useKnowledgeBaseStore } from '@/store/library';

import { usePageEditorStore } from '../store';

const styles = stylex.create({
  breadcrumb: { fontSize: '14px', color: cssVar.colorTextSecondary },
  breadcrumbItem: {
    cursor: 'pointer',
    transition: `color ${cssVar.motionDurationSlow}`,
    color: { 'default': null, ':hover': cssVar.colorText },
  },
  currentItem: { fontWeight: 500, color: cssVar.colorText },
  separator: { marginInline: '8px', color: cssVar.colorTextQuaternary },
});

interface FolderCrumb {
  id: string;
  name: string;
  slug: string;
}

const Breadcrumb = memo(() => {
  const { t } = useTranslation('file');

  const title = usePageEditorStore((s) => s.title);
  const knowledgeBaseId = usePageEditorStore((s) => s.knowledgeBaseId);
  const parentId = usePageEditorStore((s) => s.parentId);

  const knowledgeBaseName = useKnowledgeBaseStore(
    knowledgeBaseSelectors.getKnowledgeBaseNameById(knowledgeBaseId || ''),
  );

  // Fetch the parent folder to get its slug
  const useFetchKnowledgeItem = useFileStore((s) => s.useFetchKnowledgeItem);
  const { data: parentFolder } = useFetchKnowledgeItem(parentId);

  // Fetch folder breadcrumb chain from backend using parent folder's slug
  const useFetchFolderBreadcrumb = useFileStore((s) => s.useFetchFolderBreadcrumb);
  const { data: folderChain = [] } = useFetchFolderBreadcrumb(parentFolder?.slug || null);

  // If no parent folder data yet, don't render
  if (!parentFolder || !parentId) {
    return null;
  }

  const documentTitle = title || t('pageEditor.titlePlaceholder');

  return (
    <Flexbox
      horizontal
      align={'center'}
      className={stylex.props(styles.breadcrumb).className}
      flex={1}
      gap={0}
    >
      {/* Knowledge Base (root) */}
      {knowledgeBaseId && (
        <>
          <span
            className={stylex.props(styles.breadcrumbItem).className}
            style={{ cursor: 'default' }}
          >
            {knowledgeBaseName || 'Knowledge Base'}
          </span>
          <span {...stylex.props(styles.separator)}>/</span>
        </>
      )}

      {/* Folder chain */}
      {folderChain.map((folder: FolderCrumb) => (
        <Flexbox horizontal align={'center'} gap={0} key={folder.id}>
          <span
            className={stylex.props(styles.breadcrumbItem).className}
            style={{ cursor: 'default' }}
          >
            {folder.name}
          </span>
          <span {...stylex.props(styles.separator)}>/</span>
        </Flexbox>
      ))}

      {/* Current document title */}
      <span
        className={stylex.props(styles.breadcrumbItem, styles.currentItem).className}
        style={{ cursor: 'default' }}
      >
        {documentTitle}
      </span>
    </Flexbox>
  );
});

Breadcrumb.displayName = 'Breadcrumb';

export default Breadcrumb;
