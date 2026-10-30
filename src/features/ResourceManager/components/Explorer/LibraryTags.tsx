'use client';

import { Tag, Tooltip } from '@lobehub/ui';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { knowledgeBaseSelectors, useKnowledgeBaseStore } from '@/store/library';

interface LibraryTagsProps {
  knowledgeBaseIds?: string[];
}

const stopPropagation = (e: { stopPropagation: () => void }) => e.stopPropagation();

/**
 * The libraries a drive row is filed into. The drive lists every file, so the
 * tag is what tells "already organized" apart from loose uploads. Libraries the
 * caller cannot list (a teammate's private one) are left out.
 */
const LibraryTags = memo<LibraryTagsProps>(({ knowledgeBaseIds }) => {
  const { t } = useTranslation('file');
  const navigate = useWorkspaceAwareNavigate();
  const libraries = useKnowledgeBaseStore(knowledgeBaseSelectors.getKnowledgeBaseList());

  const names = useMemo(() => {
    if (!knowledgeBaseIds?.length || !libraries) return [];
    const byId = new Map(libraries.map((library) => [library.id, library.name]));
    return knowledgeBaseIds.flatMap((id) => {
      const name = byId.get(id);
      return name ? [{ id, name }] : [];
    });
  }, [knowledgeBaseIds, libraries]);

  if (names.length === 0) return null;

  const [first, ...rest] = names;

  return (
    <Tooltip title={t('docs.drive.inLibraries', { names: names.map((n) => n.name).join(', ') })}>
      <Tag
        size={'small'}
        style={{ cursor: 'pointer', flex: 'none', maxWidth: 160 }}
        onPointerDown={stopPropagation}
        onClick={(e) => {
          e.stopPropagation();
          navigate(`/resource/library/${first.id}`);
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {first.name}
        </span>
        {rest.length > 0 && ` +${rest.length}`}
      </Tag>
    </Tooltip>
  );
});

LibraryTags.displayName = 'LibraryTags';

export default LibraryTags;
