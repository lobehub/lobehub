import { Flexbox } from '@lobehub/ui';
import { createStaticStyles, cx } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useFileStore } from '@/store/file';
import { knowledgeBaseSelectors, useKnowledgeBaseStore } from '@/store/library';

import { usePageEditorStore } from '../store';

const styles = createStaticStyles(({ css, cssVar }) => ({
  breadcrumb: css`
    font-size: 14px;
    color: ${cssVar.colorTextSecondary};
  `,
  breadcrumbItem: css`
    cursor: pointer;
    transition: color ${cssVar.motionDurationSlow};

    &:hover {
      color: ${cssVar.colorText};
    }
  `,
  currentItem: css`
    font-weight: 500;
    color: ${cssVar.colorText};
  `,
  separator: css`
    margin-inline: 8px;
    color: ${cssVar.colorTextQuaternary};
  `,
}));

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
    <Flexbox horizontal align={'center'} className={styles.breadcrumb} flex={1} gap={0}>
      {/* Knowledge Base (root) */}
      {knowledgeBaseId && (
        <>
          <span className={styles.breadcrumbItem} style={{ cursor: 'default' }}>
            {knowledgeBaseName || 'Knowledge Base'}
          </span>
          <span className={styles.separator}>/</span>
        </>
      )}

      {/* Folder chain */}
      {folderChain.map((folder: FolderCrumb) => (
        <Flexbox horizontal align={'center'} gap={0} key={folder.id}>
          <span className={styles.breadcrumbItem} style={{ cursor: 'default' }}>
            {folder.name}
          </span>
          <span className={styles.separator}>/</span>
        </Flexbox>
      ))}

      {/* Current document title */}
      <span className={cx(styles.breadcrumbItem, styles.currentItem)} style={{ cursor: 'default' }}>
        {documentTitle}
      </span>
    </Flexbox>
  );
});

Breadcrumb.displayName = 'Breadcrumb';

export default Breadcrumb;
