import { Button, createModal, Empty, Flexbox, SearchBar, Text, toast } from '@lobehub/ui';
import { t } from 'i18next';
import { BookOpenIcon, CheckIcon, PlusIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import KnowledgeIcon from '@/components/KnowledgeIcon';
import { knowledgeBaseSelectors, useKnowledgeBaseStore } from '@/store/library';
import { useProjectStore } from '@/store/project';
import { KnowledgeType } from '@/types/knowledgeBase';

interface AddKnowledgeBaseParams {
  existingIds: string[];
  projectId: string;
  /**
   * A shared project only offers shared libraries: a private library would be
   * invisible to every other project member.
   */
  visibility?: 'public';
}

function AddKnowledgeBaseContent({ existingIds, projectId, visibility }: AddKnowledgeBaseParams) {
  const { t } = useTranslation('project');
  const [search, setSearch] = useState('');
  const [added, setAdded] = useState<string[]>(existingIds);
  const [pendingId, setPendingId] = useState<string>();
  const addProjectKnowledgeBases = useProjectStore((s) => s.addProjectKnowledgeBases);
  const useFetchKnowledgeBaseList = useKnowledgeBaseStore((s) => s.useFetchKnowledgeBaseList);
  const { error, isHydrated, isValidating, revalidate } = useFetchKnowledgeBaseList(visibility);
  const list = useKnowledgeBaseStore(knowledgeBaseSelectors.getKnowledgeBaseList(visibility));

  const query = search.trim().toLowerCase();
  const items = (list ?? []).filter(
    (item) =>
      !query ||
      item.name.toLowerCase().includes(query) ||
      item.description?.toLowerCase().includes(query),
  );

  const add = async (knowledgeBaseId: string) => {
    setPendingId(knowledgeBaseId);
    try {
      await addProjectKnowledgeBases(projectId, [knowledgeBaseId]);
      setAdded((ids) => [...ids, knowledgeBaseId]);
    } catch (error) {
      console.error('Failed to add project knowledge base', error);
      toast.error(t('knowledgeBases.addFailed'));
    } finally {
      setPendingId(undefined);
    }
  };

  const loading = !list && (!isHydrated || isValidating);

  return (
    <Flexbox gap={12} style={{ maxHeight: 520 }}>
      <SearchBar
        allowClear
        placeholder={t('knowledgeBases.searchPlaceholder')}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      {error && !list ? (
        <AsyncError error={error} onRetry={() => revalidate()} />
      ) : loading ? (
        <Text type="secondary">{t('loading', { ns: 'common' })}</Text>
      ) : items.length === 0 ? (
        <Empty
          description={t(query ? 'knowledgeBases.noMatch' : 'knowledgeBases.libraryEmpty')}
          icon={BookOpenIcon}
        />
      ) : (
        <Flexbox gap={4} style={{ overflow: 'auto' }}>
          {items.map((item) => {
            const isAdded = added.includes(item.id);
            return (
              <Flexbox horizontal align="center" gap={12} key={item.id} paddingBlock={8}>
                <KnowledgeIcon name={item.name} size={28} type={KnowledgeType.KnowledgeBase} />
                <Flexbox flex={1} gap={2} style={{ minWidth: 0 }}>
                  <Text ellipsis weight={500}>
                    {item.name}
                  </Text>
                  {item.description ? (
                    <Text ellipsis fontSize={12} type="secondary">
                      {item.description}
                    </Text>
                  ) : null}
                </Flexbox>
                <Button
                  disabled={isAdded}
                  icon={isAdded ? CheckIcon : PlusIcon}
                  loading={pendingId === item.id}
                  size="small"
                  onClick={() => add(item.id)}
                >
                  {t(isAdded ? 'knowledgeBases.added' : 'knowledgeBases.add')}
                </Button>
              </Flexbox>
            );
          })}
        </Flexbox>
      )}
    </Flexbox>
  );
}

export const openAddKnowledgeBaseModal = (params: AddKnowledgeBaseParams) =>
  createModal({
    content: <AddKnowledgeBaseContent {...params} />,
    footer: null,
    title: t('knowledgeBases.addTitle', { ns: 'project' }),
    width: 560,
  });
