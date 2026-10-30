import { Flexbox, Skeleton } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';

import { useFolderPath } from '@/features/ResourceManager/hooks/useFolderPath';
import { useResourceManagerStore } from '@/features/ResourceManager/store';
import { libraryFolderPath } from '@/features/ResourceManager/utils/resourcePath';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useFileStore } from '@/store/file';
import { knowledgeBaseSelectors, useKnowledgeBaseStore } from '@/store/library';
import { FilesTabs } from '@/types/files';

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

interface BreadcrumbProps {
  category?: string;
  fileName?: string;
  knowledgeBaseId?: string;
}

interface FolderCrumb {
  id: string;
  name: string;
  slug: string;
}

const Breadcrumb = memo<BreadcrumbProps>(({ category, fileName }) => {
  const { t } = useTranslation('file');
  const navigate = useWorkspaceAwareNavigate();
  const [searchParams] = useSearchParams();
  const { currentFolderId, knowledgeBaseId: currentKnowledgeBaseId } = useFolderPath();

  const setMode = useResourceManagerStore((s) => s.setMode);
  const setCurrentViewItemId = useResourceManagerStore((s) => s.setCurrentViewItemId);

  const baseKnowledgeBaseId = currentKnowledgeBaseId;
  const knowledgeBaseName = useKnowledgeBaseStore(
    knowledgeBaseSelectors.getKnowledgeBaseNameById(baseKnowledgeBaseId || ''),
  );

  // Fetch folder breadcrumb chain from backend
  const useFetchFolderBreadcrumb = useFileStore((s) => s.useFetchFolderBreadcrumb);
  const { data: folderChain = [] } = useFetchFolderBreadcrumb(currentFolderId);

  // When in inbox mode (no knowledgeBaseId), show category in breadcrumb
  if (!baseKnowledgeBaseId) {
    if (!category || category === FilesTabs.All) {
      return null;
    }

    const categoryLabel = t(`tab.${category as FilesTabs}` as any);

    return (
      <Flexbox
        horizontal
        align={'center'}
        className={stylex.props(styles.breadcrumb).className}
        gap={0}
      >
        <span
          className={stylex.props(styles.breadcrumbItem, styles.currentItem).className}
          style={{ cursor: 'default' }}
        >
          {categoryLabel}
        </span>
      </Flexbox>
    );
  }

  const handleNavigate = (folderId: string | null) => {
    // If navigating while viewing a file, reset the file view mode
    if (fileName) {
      setMode('explorer');
      setCurrentViewItemId(undefined);
    }

    // Preserve existing query parameters (view and sort preferences)
    const newParams = new URLSearchParams(searchParams);
    // Remove 'file' parameter when navigating away
    newParams.delete('file');

    const queryString = newParams.toString();
    const basePath = libraryFolderPath(baseKnowledgeBaseId, folderId);

    navigate(queryString ? `${basePath}?${queryString}` : basePath);
  };

  const isAtRoot = folderChain.length === 0 && !fileName;
  const isRootClickable = folderChain.length > 0 || fileName;

  return (
    <Flexbox
      horizontal
      align={'center'}
      className={stylex.props(styles.breadcrumb).className}
      gap={0}
    >
      <span
        className={stylex.props(styles.breadcrumbItem, isAtRoot && styles.currentItem).className}
        style={{ cursor: isRootClickable ? 'pointer' : 'default' }}
        onClick={() => isRootClickable && handleNavigate(null)}
      >
        {knowledgeBaseName ? (
          knowledgeBaseName
        ) : (
          <Skeleton style={{ height: 14, minWidth: 80, width: 80 }} />
        )}
      </span>

      {folderChain.map((folder: FolderCrumb, index: number) => {
        const isLast = index === folderChain.length - 1 && !fileName;
        return (
          <Flexbox horizontal align={'center'} gap={0} key={folder.id}>
            <span {...stylex.props(styles.separator)}>/</span>
            <span
              style={{ cursor: isLast ? 'default' : 'pointer' }}
              className={
                stylex.props(styles.breadcrumbItem, isLast && styles.currentItem).className
              }
              onClick={() => !isLast && handleNavigate(folder.id)}
            >
              {folder.name}
            </span>
          </Flexbox>
        );
      })}

      {fileName && (
        <Flexbox horizontal align={'center'} gap={0}>
          <span {...stylex.props(styles.separator)}>/</span>
          <span
            className={stylex.props(styles.breadcrumbItem, styles.currentItem).className}
            style={{ cursor: 'default' }}
          >
            {fileName}
          </span>
        </Flexbox>
      )}
    </Flexbox>
  );
});

Breadcrumb.displayName = 'Breadcrumb';

export default Breadcrumb;
