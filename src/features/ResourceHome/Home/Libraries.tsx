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
  card: css`
    cursor: pointer;

    display: flex;
    flex-direction: column;
    gap: 8px;

    padding: 16px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};

    text-align: start;

    background: ${cssVar.colorBgContainer};

    transition: all 0.2s ${cssVar.motionEaseInOut};

    &:hover {
      border-color: ${cssVar.colorBorder};
      box-shadow: ${cssVar.boxShadowTertiary};
    }
  `,
  createCard: css`
    cursor: pointer;

    display: flex;
    gap: 8px;
    align-items: center;
    justify-content: center;

    min-height: 88px;
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
  description: css`
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;

    font-size: 12px;
    color: ${cssVar.colorTextSecondary};
  `,
  grid: css`
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
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
          {Array.from({ length: 3 }, (_, index) => (
            <Skeleton.Node active key={index} style={{ height: 88, width: '100%' }} />
          ))}
        </div>
      ) : (
        <div className={styles.grid}>
          {data?.map((item) => (
            <button
              className={styles.card}
              key={item.id}
              type={'button'}
              onClick={() => {
                setLibraryId(item.id);
                navigate(`/resource/library/${item.id}`);
              }}
            >
              <Flexbox horizontal align={'center'} gap={8}>
                <LibIcon size={18} />
                <span className={styles.name}>{item.name}</span>
              </Flexbox>
              {item.description && <span className={styles.description}>{item.description}</span>}
            </button>
          ))}
          <button
            className={styles.createCard}
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
