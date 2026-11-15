'use client';

import { Button, cssVar, Empty, Flexbox, Tabs } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { LibraryBigIcon, PlusIcon } from 'lucide-react';
import { memo, useLayoutEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';

import AsyncBoundary from '@/components/AsyncBoundary';
import {
  RESOURCE_HOME_SECTIONS,
  ResourceSectionSkeleton,
} from '@/components/Skeleton/ResourceHome';
import { useCreateNewModal } from '@/features/LibraryModal';
import NavHeader from '@/features/NavHeader';
import { useResourceManagerStore } from '@/features/ResourceManager/store';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { usePermission } from '@/hooks/usePermission';
import { knowledgeBaseSelectors, useKnowledgeBaseStore } from '@/store/library';
import { serverConfigSelectors, useServerConfigStore } from '@/store/serverConfig';

import AgentSpaceGallery from './AgentSpaceGallery';
import { CreateLibraryCard, LibraryCard, libraryCardStyles } from './LibraryCard';

const TAB_PARAM = 'tab';
const AGENTS_TAB = 'agents';
const MINE_TAB = 'mine';

const styles = stylex.create({
  content: {
    width: '100%',
    maxWidth: '1200px',
    marginInline: 'auto',
    paddingBlockStart: '32px',
    paddingBlockEnd: '64px',
    paddingInline: '32px',
  },
  scroll: {
    overflowX: 'hidden',
    overflowY: 'auto',
    flex: '1',
  },
});

/**
 * Every library of the current Docs mode as a cover card — the library index.
 * The sidebar keeps only the few opened most recently.
 */
const LibraryGallery = memo(() => {
  const { t } = useTranslation('file');
  const navigate = useWorkspaceAwareNavigate();
  const { allowed: canCreate, reason } = usePermission('create_content');
  const { open: openCreateLibrary } = useCreateNewModal();
  const showAgentSpaces = useServerConfigStore(serverConfigSelectors.enableAgentKnowledgeSpace);
  // In the URL so coming back from an agent's library lands on the same tab.
  const [searchParams, setSearchParams] = useSearchParams();
  const showingAgents = showAgentSpaces && searchParams.get(TAB_PARAM) === AGENTS_TAB;
  const setLibraryId = useResourceManagerStore((s) => s.setLibraryId);
  // Coming back from a library, its id must not keep scoping uploads and lists.
  useLayoutEffect(() => {
    setLibraryId(undefined);
  }, [setLibraryId]);

  // Same surface as the sidebar: the Private / Workspace mode narrows the list.
  const listVisibility = useResourceManagerStore((s) => s.listVisibility);
  const visibility = listVisibility === 'private' ? ('private' as const) : ('public' as const);
  const useFetchKnowledgeBaseList = useKnowledgeBaseStore((s) => s.useFetchKnowledgeBaseList);
  const { error, isHydrated, revalidate } = useFetchKnowledgeBaseList(visibility);
  const data = useKnowledgeBaseStore(knowledgeBaseSelectors.getKnowledgeBaseList(visibility));

  const openLibrary = (id: string) => {
    setLibraryId(id);
    navigate(`/resource/library/${id}`);
  };

  const handleCreate = () => {
    if (!canCreate) return;
    openCreateLibrary({ onSuccess: openLibrary });
  };

  return (
    <Flexbox height={'100%'}>
      <NavHeader
        style={{ borderBottom: `1px solid ${cssVar.colorBorderSecondary}` }}
        left={
          <Flexbox horizontal align={'center'} gap={12} style={{ marginLeft: 8 }}>
            <span style={{ whiteSpace: 'nowrap' }}>{t('docs.section.library')}</span>
            {showAgentSpaces && (
              <Tabs
                activeKey={showingAgents ? AGENTS_TAB : MINE_TAB}
                size={'small'}
                variant={'rounded'}
                items={[
                  { key: MINE_TAB, label: t('docs.library.tabs.mine') },
                  { key: AGENTS_TAB, label: t('docs.library.tabs.agents') },
                ]}
                onChange={(key) =>
                  setSearchParams(key === AGENTS_TAB ? { [TAB_PARAM]: AGENTS_TAB } : {}, {
                    replace: true,
                  })
                }
              />
            )}
          </Flexbox>
        }
        right={
          showingAgents ? undefined : (
            <Button
              disabled={!canCreate}
              icon={PlusIcon}
              title={canCreate ? undefined : reason}
              type={'primary'}
              onClick={handleCreate}
            >
              {t('library.new')}
            </Button>
          )
        }
      />
      <div {...stylex.props(styles.scroll)}>
        <div {...stylex.props(styles.content)}>
          {showingAgents ? (
            <AgentSpaceGallery onOpen={openLibrary} />
          ) : (
            <AsyncBoundary
              data={data}
              error={error}
              isEmpty={data?.length === 0}
              isLoading={!data && (!isHydrated || !error)}
              loading={<ResourceSectionSkeleton {...RESOURCE_HOME_SECTIONS.libraries} />}
              empty={
                <Empty
                  description={t('docs.library.emptyDesc')}
                  icon={LibraryBigIcon}
                  title={t('docs.library.emptyTitle')}
                  action={
                    <Button
                      disabled={!canCreate}
                      icon={PlusIcon}
                      size={'middle'}
                      onClick={handleCreate}
                    >
                      {t('library.new')}
                    </Button>
                  }
                />
              }
              onRetry={() => revalidate()}
            >
              <div {...stylex.props(libraryCardStyles.grid)}>
                {data?.map((library) => (
                  <LibraryCard key={library.id} library={library} onOpen={openLibrary} />
                ))}
                <CreateLibraryCard disabled={!canCreate} onCreate={handleCreate} />
              </div>
            </AsyncBoundary>
          )}
        </div>
      </div>
    </Flexbox>
  );
});

LibraryGallery.displayName = 'LibraryGallery';

export default LibraryGallery;
