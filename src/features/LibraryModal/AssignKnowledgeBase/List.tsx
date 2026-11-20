import { type KnowledgeItem } from '@lobechat/types';
import {
  Alert,
  Button,
  Center,
  Empty,
  Flexbox,
  Icon,
  SearchBar,
  Segmented,
  Select,
} from '@lobehub/ui';
import { BookOpen, FileText, PlusIcon, SearchX, ServerCrash } from 'lucide-react';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Virtuoso } from 'react-virtuoso';

import { useAgentStore } from '@/store/agent';
import { agentKnowledgeSelectors } from '@/store/agent/selectors';

import { useCreateNewModal } from '../CreateNew';
import {
  filterPickerItems,
  itemsOfKind,
  type PickerKind,
  type PickerSort,
} from './filterPickerItems';
import Item from './Item';
import Loading from './Loading';
import { resolvePickerScope } from './resolvePickerScope';
import VisibilityTabs, { type PickerVisibility } from './VisibilityTabs';

/** Stable empty list so an un-loaded surface never hands Virtuoso a new array each render. */
const EMPTY_KNOWLEDGE: KnowledgeItem[] = [];

interface ListProps {
  defaultKind: PickerKind;
}

export const List = memo<ListProps>(({ defaultKind }) => {
  const { t } = useTranslation(['chat', 'file']);

  const [
    useFetchFilesAndKnowledgeBases,
    activeAgentId,
    agentVisibility,
    agentWorkspaceId,
    addKnowledgeBaseToAgent,
  ] = useAgentStore((s) => [
    s.useFetchFilesAndKnowledgeBases,
    s.activeAgentId,
    s.activeAgentId ? s.agentMap[s.activeAgentId]?.visibility : undefined,
    s.activeAgentId ? s.agentMap[s.activeAgentId]?.workspaceId : undefined,
    s.addKnowledgeBaseToAgent,
  ]);

  const [kind, setKind] = useState<PickerKind>(defaultKind);
  const [keyword, setKeyword] = useState('');
  const [sort, setSort] = useState<PickerSort>('updatedAt');
  const [mode, setMode] = useState<PickerVisibility>('public');
  const { effectiveVisibility, showPublicAgentHint, showVisibilityTabs } = resolvePickerScope({
    agentVisibility,
    agentWorkspaceId,
    mode,
  });

  const { isLoading, error } = useFetchFilesAndKnowledgeBases(activeAgentId, effectiveVisibility);
  // The rows land in the knowledge replica; read them through the selector so a
  // fetched / hydrated list re-renders the picker.
  const data = useAgentStore(
    agentKnowledgeSelectors.getAgentKnowledgeList(
      activeAgentId ? { agentId: activeAgentId, visibility: effectiveVisibility } : undefined,
    ),
  );
  const items = data ?? EMPTY_KNOWLEDGE;
  const visibleItems = useMemo(
    () => filterPickerItems({ items, keyword, kind, sort }),
    [items, keyword, kind, sort],
  );
  const libraryCount = useMemo(() => itemsOfKind(items, 'library').length, [items]);
  const fileCount = useMemo(() => itemsOfKind(items, 'file').length, [items]);

  // A new library is created for this agent, so it is attached as soon as it exists.
  const { open: openCreateLibrary } = useCreateNewModal();
  const createLibrary = () =>
    // Created in the tab's scope, so a library made from the Private tab stays private and
    // remains in this list once attached.
    openCreateLibrary({
      onSuccess: (id) => void addKnowledgeBaseToAgent(id),
      visibility: effectiveVisibility,
    });

  const kindEmpty = (kind === 'library' ? libraryCount : fileCount) === 0;

  const renderEmpty = () => {
    if (error)
      return (
        <>
          <Icon icon={ServerCrash} size={64} />
          {t('networkError', { ns: 'file' })}
        </>
      );

    if (!kindEmpty) return <Empty description={t('knowledgeBase.picker.noMatch')} icon={SearchX} />;

    return kind === 'library' ? (
      <Empty
        description={t('knowledgeBase.picker.libraryEmpty')}
        icon={BookOpen}
        action={
          <Button icon={<Icon icon={PlusIcon} />} type={'primary'} onClick={createLibrary}>
            {t('knowledgeBase.picker.createLibrary')}
          </Button>
        }
      />
    ) : (
      <Empty description={t('knowledgeBase.picker.fileEmpty')} icon={FileText} />
    );
  };

  return (
    <Flexbox height={500}>
      {/*
       * Toolbar sits flush with the list items below: Virtuoso uses
       * `marginInline: -16` to pull rows back to the outer edge and each
       * Item re-applies `paddingInline={16}`.
       */}
      <Flexbox gap={12} style={{ paddingBlockEnd: 8 }}>
        <Flexbox horizontal align={'center'} gap={8} justify={'space-between'}>
          <Segmented
            value={kind}
            options={[
              {
                label: `${t('knowledgeBase.picker.tabs.library')} ${libraryCount || ''}`.trim(),
                value: 'library',
              },
              {
                label: `${t('knowledgeBase.picker.tabs.file')} ${fileCount || ''}`.trim(),
                value: 'file',
              },
            ]}
            onChange={(value) => setKind(value as PickerKind)}
          />
          {showVisibilityTabs && <VisibilityTabs value={mode} onChange={setMode} />}
        </Flexbox>
        <Flexbox horizontal align={'center'} gap={8}>
          <Flexbox flex={1}>
            <SearchBar
              allowClear
              value={keyword}
              variant={'outlined'}
              placeholder={
                kind === 'library'
                  ? t('knowledgeBase.picker.searchLibrary')
                  : t('knowledgeBase.picker.searchFile')
              }
              onInputChange={setKeyword}
            />
          </Flexbox>
          <Select
            style={{ flex: 'none', width: 136 }}
            value={sort}
            variant={'filled'}
            options={[
              { label: t('knowledgeBase.picker.sort.updatedAt'), value: 'updatedAt' },
              { label: t('knowledgeBase.picker.sort.createdAt'), value: 'createdAt' },
              { label: t('knowledgeBase.picker.sort.name'), value: 'name' },
              { label: t('knowledgeBase.picker.sort.nameDesc'), value: 'nameDesc' },
            ]}
            onChange={(value) => setSort(value as PickerSort)}
          />
        </Flexbox>
        {showPublicAgentHint && (
          <Alert showIcon message={t('resources.knowledgePicker.publicAgentHint')} type={'info'} />
        )}
      </Flexbox>
      {isLoading ? (
        <Loading />
      ) : visibleItems.length === 0 ? (
        <Center flex={1} gap={12} padding={40}>
          {renderEmpty()}
        </Center>
      ) : (
        <Virtuoso
          data={visibleItems}
          increaseViewportBy={typeof window !== 'undefined' ? window.innerHeight : 0}
          itemContent={(_, item) => <Item key={item.id} {...item} />}
          overscan={24}
          style={{ flex: 1, marginInline: -16 }}
        />
      )}
    </Flexbox>
  );
});

export default List;
