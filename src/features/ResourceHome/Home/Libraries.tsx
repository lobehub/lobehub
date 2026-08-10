'use client';

import { Flexbox, Icon } from '@lobehub/ui';
import { Skeleton } from 'antd';
import { createStaticStyles } from 'antd-style';
import { PlusIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import LibIcon from '@/components/LibIcon';
import { useCreateNewModal } from '@/features/LibraryModal';
import { useResourceManagerStore } from '@/features/ResourceManager/store';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { usePermission } from '@/hooks/usePermission';
import { useKnowledgeBaseStore } from '@/store/library';

import SectionTitle from './SectionTitle';

const styles = createStaticStyles(({ css, cssVar }) => ({
  chip: css`
    cursor: pointer;

    display: flex;
    gap: 10px;
    align-items: center;

    min-width: 0;
    padding-block: 14px;
    padding-inline: 16px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};

    text-align: start;

    background: ${cssVar.colorFillQuaternary};

    transition: all 0.2s ${cssVar.motionEaseInOut};

    &:hover {
      border-color: ${cssVar.colorBorder};
      background: ${cssVar.colorFillTertiary};
    }
  `,
  createChip: css`
    cursor: pointer;

    display: flex;
    gap: 8px;
    align-items: center;
    justify-content: center;

    padding-block: 14px;
    padding-inline: 16px;
    border: 1px dashed ${cssVar.colorBorder};
    border-radius: ${cssVar.borderRadiusLG};

    color: ${cssVar.colorTextSecondary};

    background: transparent;

    transition: all 0.2s ${cssVar.motionEaseInOut};

    &:hover {
      border-color: ${cssVar.colorTextQuaternary};
      color: ${cssVar.colorText};
    }

    &:disabled {
      cursor: not-allowed;
      opacity: 0.5;
    }
  `,
  grid: css`
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 12px;
  `,
  name: css`
    overflow: hidden;

    font-size: 13px;
    font-weight: 500;
    color: ${cssVar.colorText};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
}));

/**
 * How many libraries the quick-access row shows. The list is ordered by last
 * update, so this is "the ones you are working in"; the sidebar stays the full
 * index, which is why the home page must not repeat every library here.
 */
const MAX_LIBRARIES = 9;

/**
 * Quick access to the user's libraries — the everyday entry point of the
 * library home, and the page's only library list.
 */
const Libraries = memo(() => {
  const { t } = useTranslation('file');
  const navigate = useWorkspaceAwareNavigate();
  const { allowed: canCreate } = usePermission('create_content');

  const listVisibility = useResourceManagerStore((s) => s.listVisibility);
  const visibility = listVisibility === 'private' ? ('private' as const) : ('public' as const);

  const useFetchKnowledgeBaseList = useKnowledgeBaseStore((s) => s.useFetchKnowledgeBaseList);
  const { data, isLoading } = useFetchKnowledgeBaseList(visibility);

  const setLibraryId = useResourceManagerStore((s) => s.setLibraryId);
  const { open: openCreateLibrary } = useCreateNewModal();

  const handleCreate = () => {
    if (!canCreate) return;
    openCreateLibrary({
      onSuccess: (id) => {
        navigate(`/resource/library/${id}`);
      },
    });
  };

  return (
    <Flexbox gap={12}>
      <SectionTitle title={t('home.libraries')} />
      {isLoading ? (
        <div className={styles.grid}>
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton.Node active key={index} style={{ height: 52, width: '100%' }} />
          ))}
        </div>
      ) : (
        <div className={styles.grid}>
          {data?.slice(0, MAX_LIBRARIES).map((item) => (
            <button
              className={styles.chip}
              key={item.id}
              type={'button'}
              onClick={() => {
                setLibraryId(item.id);
                navigate(`/resource/library/${item.id}`);
              }}
            >
              <LibIcon size={18} />
              <span className={styles.name}>{item.name}</span>
            </button>
          ))}
          <button
            className={styles.createChip}
            disabled={!canCreate}
            type={'button'}
            onClick={handleCreate}
          >
            <Icon icon={PlusIcon} size={16} />
            {t('home.uploadEntries.library.title')}
          </button>
        </div>
      )}
    </Flexbox>
  );
});

Libraries.displayName = 'Libraries';

export default Libraries;
